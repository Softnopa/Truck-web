// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// Called by the owner app (lib/api.ts `sendTelegramMessage`) with the owner's
// session token attached automatically by supabase-js. The bot token is a
// secret set in the function's environment (Dashboard -> Edge Functions ->
// send-telegram -> Secrets) and never ships to the app.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// The app also runs as a web build, and a browser will not POST here until a
// preflight OPTIONS has been answered with these. Without them the request was
// blocked before it left the page: the owner pressed Send, and nothing at all
// happened — no message, no error, nothing in the log. Repeated in each
// function on purpose; they are pasted into the dashboard one file at a time.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

/** Machine-readable reasons: the app maps these to a sentence in RU/UZ/EN. */
function fail(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: JSON_HEADERS,
  });
}

/** Telegram's own refusals, translated into the codes the app understands. */
function classifyTelegram(status: number, description: string): { code: string; status: number } {
  const text = description.toLowerCase();
  if (text.includes('blocked by the user')) return { code: 'blocked', status: 403 };
  if (text.includes('chat not found') || text.includes('user is deactivated')) {
    return { code: 'not_linked', status: 409 };
  }
  if (status === 401 || text.includes('unauthorized')) {
    return { code: 'not_configured', status: 500 };
  }
  return { code: 'telegram_failed', status: 502 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('bad_request', 405, 'Method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('unauthorized', 401, 'Sign in first');

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    return fail('not_configured', 500, 'TELEGRAM_BOT_TOKEN is not set on this function');
  }

  // Uses the caller's own JWT, so `clients` RLS (owners only) applies here
  // exactly as it would from the app — no separate ownership check needed.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const body = await req.json().catch(() => null);
  const clientId = typeof body?.clientId === 'string' ? body.clientId : null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!clientId || !message) {
    return fail('bad_request', 400, 'clientId and message are required');
  }
  // Telegram rejects anything past 4096 characters outright.
  const text = message.slice(0, 4000);

  const { data: client, error } = await supabase
    .from('clients')
    .select('name, telegram_chat_id')
    .eq('id', clientId)
    .maybeSingle();

  if (error) return fail('server_error', 500, error.message);
  if (!client) return fail('not_found', 404, 'No such client, or you cannot see it');
  if (!client.telegram_chat_id) {
    return fail('not_linked', 409, 'This client has not opened the invite link yet');
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: client.telegram_chat_id,
      text,
      // No parse_mode: an owner typing an underscore or asterisk into a message
      // must not have it swallowed as markup, or worse, rejected as bad markup.
      disable_web_page_preview: true,
    }),
  });

  const result = await tgRes.json().catch(() => null);
  if (!tgRes.ok || !result?.ok) {
    const description = String(result?.description ?? `HTTP ${tgRes.status}`);
    const { code, status } = classifyTelegram(tgRes.status, description);
    console.error('sendMessage failed', clientId, tgRes.status, description);
    return fail(code, status, description);
  }

  return new Response(JSON.stringify({ ok: true, messageId: result.result?.message_id ?? null }), {
    headers: JSON_HEADERS,
  });
});
