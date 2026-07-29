// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// Called by the owner app (lib/api.ts `sendTelegramMessage`) with the owner's
// session token attached automatically by supabase-js. The bot token is a
// secret set in the function's environment (Dashboard -> Edge Functions ->
// send-telegram -> Secrets) and never ships to the app.
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) return new Response('Bot not configured', { status: 500 });

  // Uses the caller's own JWT, so `clients` RLS (owner_id = auth.uid()) applies
  // here exactly as it would from the app — no separate ownership check needed.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const body = await req.json().catch(() => null);
  const clientId = typeof body?.clientId === 'string' ? body.clientId : null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!clientId || !message) {
    return new Response('clientId and message are required', { status: 400 });
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('telegram_chat_id')
    .eq('id', clientId)
    .maybeSingle();

  if (error || !client) return new Response('Client not found', { status: 404 });
  if (!client.telegram_chat_id) {
    return new Response('Client has not linked Telegram yet', { status: 409 });
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: client.telegram_chat_id, text: message }),
  });

  if (!tgRes.ok) {
    return new Response(`Telegram send failed: ${await tgRes.text()}`, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
