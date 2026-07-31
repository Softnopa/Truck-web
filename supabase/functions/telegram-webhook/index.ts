// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
// Set "Verify JWT" to OFF for this one: Telegram calls it, and Telegram has no
// Supabase session. With verification on, every update is rejected before it
// reaches this code and the bot looks dead.
//
// Telegram calls this URL whenever a client interacts with the bot. We only
// act on `/start <invite_code>` (sent the moment someone opens the
// t.me/<bot>?start=<code> link an owner shared) — that is what proves a chat
// id belongs to a specific client row.
//
// After deploying, register this URL with Telegram (see README, "Telegram") —
// the setWebhook call must pass the same secret_token as TELEGRAM_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Never leaves anyone staring at a bot that said nothing. */
async function reply(botToken: string | undefined, chatId: number, text: string): Promise<void> {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('reply failed', chatId, err);
  }
}

/**
 * The payload of a `/start` command, or null when this is not one.
 *
 * `startsWith('/start')` was too loose — it also matched `/startover` — and
 * Telegram appends `@botname` to commands sent in groups, which the old
 * `replace('/start', '')` left glued to the code.
 */
function startPayload(text: string): string | null {
  const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
  if (!match) return null;
  return match[1] ?? '';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Telegram echoes this header on every call once set via setWebhook's
  // secret_token param — the only thing standing between this public URL and
  // anyone who finds it.
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!expected) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not set — every update will be rejected');
    return new Response('Unauthorized', { status: 401 });
  }
  if (got !== expected) return new Response('Unauthorized', { status: 401 });

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const update = await req.json().catch(() => null);
  const message = update?.message ?? update?.edited_message;
  const text: string | undefined = message?.text;
  const chatId: number | undefined = message?.chat?.id;
  const chatType: string = message?.chat?.type ?? update?.my_chat_member?.chat?.type ?? 'private';
  const inGroup = chatType === 'group' || chatType === 'supergroup';

  // Being added to a group carries no invite code with it: `?startgroup=` is
  // not guaranteed to deliver its payload once the bot lands. Say what to do
  // rather than sit there looking connected when nothing is linked.
  const added = update?.my_chat_member;
  if (added && typeof added.chat?.id === 'number') {
    const status: string = added.new_chat_member?.status ?? '';
    if (status === 'member' || status === 'administrator') {
      await reply(
        botToken,
        added.chat.id,
        'Send /start followed by the group code from the app, and I will post sales here.'
      );
    }
    return new Response('ok');
  }

  // Telegram retries non-2xx responses, so anything we choose not to act on
  // still gets a 200 once the body has been read.
  if (!text || typeof chatId !== 'number') return new Response('ok');

  const code = startPayload(text);
  if (code === null) return new Response('ok');

  if (!code) {
    // `/start` typed by hand, with no invite code attached.
    await reply(
      botToken,
      chatId,
      'Hello. To receive messages here, open the invite link your supplier sent you.'
    );
    return new Response('ok');
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, kind, telegram_chat_id')
    .eq('invite_code', code)
    .maybeSingle();

  if (error) {
    console.error('invite lookup failed', error.message);
    return new Response('ok');
  }

  if (!client) {
    await reply(botToken, chatId, 'That invite link is not valid. Ask your supplier for a new one.');
    return new Response('ok');
  }

  // A code minted for a group must not bind a private chat, or the sales
  // report would start arriving as a DM to whoever tried it — and a person's
  // reminders must never land in a group where everyone reads them.
  const wantsGroup = client.kind === 'group';
  if (wantsGroup !== inGroup) {
    await reply(
      botToken,
      chatId,
      wantsGroup
        ? 'That code belongs to a group. Add me to the group and send it there.'
        : 'That code belongs to one person. Send it to me in a private chat.'
    );
    return new Response('ok');
  }

  const name = client.name ? `, ${client.name}` : '';

  // Already this chat: the client pressed Start twice, or reopened the link.
  // Silence here read as a broken bot, which is how it was reported.
  const connected = wantsGroup
    ? `Connected${name}. Sales will be posted here.`
    : `You're connected${name}. You'll get messages here.`;

  if (client.telegram_chat_id === chatId) {
    await reply(botToken, chatId, `Already connected${name}.`);
    return new Response('ok');
  }

  // Linked to somebody else's chat. Re-pointing it on demand would let anyone
  // holding a forwarded link take over the contact's messages, so it stays put.
  if (client.telegram_chat_id) {
    await reply(botToken, chatId, 'That invite link is already in use. Ask your supplier for a new one.');
    return new Response('ok');
  }

  const { error: linkError } = await supabase
    .from('clients')
    .update({ telegram_chat_id: chatId, telegram_linked_at: new Date().toISOString() })
    .eq('id', client.id)
    // Guards against two people opening the same link at the same moment.
    .is('telegram_chat_id', null);

  if (linkError) {
    console.error('link failed', client.id, linkError.message);
    await reply(botToken, chatId, 'Something went wrong connecting you. Please try the link again.');
    return new Response('ok');
  }

  await reply(botToken, chatId, connected);
  return new Response('ok');
});
