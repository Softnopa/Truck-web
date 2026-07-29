// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// Telegram calls this URL whenever a client interacts with the bot. We only
// act on `/start <invite_code>` (sent the moment someone opens the
// t.me/<bot>?start=<code> link an owner shared) — that is what proves a chat
// id belongs to a specific client row.
//
// After deploying, register this URL with Telegram (see project README /
// deployment notes for the exact curl command using setWebhook).
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Telegram echoes this header on every call once set via setWebhook's
  // secret_token param — the only thing standing between this public URL and
  // anyone who finds it.
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!expected || got !== expected) return new Response('Unauthorized', { status: 401 });

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const update = await req.json().catch(() => null);
  const text: string | undefined = update?.message?.text;
  const chatId: number | undefined = update?.message?.chat?.id;

  // Telegram retries non-2xx responses, so anything we choose not to act on
  // still gets a 200 once the body has been read.
  if (!text || !chatId || !text.startsWith('/start')) return new Response('ok');

  const code = text.replace('/start', '').trim();
  if (!code) return new Response('ok');

  const { data: client } = await supabase
    .from('clients')
    .update({ telegram_chat_id: chatId, telegram_linked_at: new Date().toISOString() })
    .eq('invite_code', code)
    .is('telegram_chat_id', null)
    .select('name')
    .maybeSingle();

  if (client && botToken) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `You're connected${client.name ? `, ${client.name}` : ''}. You'll get messages here.`,
      }),
    });
  }

  return new Response('ok');
});
