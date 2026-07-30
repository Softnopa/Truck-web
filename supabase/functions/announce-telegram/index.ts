// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// Posts a line in the Telegram channel whenever an owner adds a truck or
// records a sale. Called by the app (lib/api.ts `announceToChannel`) with the
// owner's session token attached automatically by supabase-js.
//
// The caller sends only a kind and an id — never the text. The message is built
// here from the row as the database has it, read back under the caller's own
// JWT, so a client cannot announce a sale that does not exist or inflate the
// figures in one that does.
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN    the bot, shared with the other two functions
//   TELEGRAM_CHANNEL_ID   e.g. -1001234567890 — see tools/telegram, `channel`
//   TELEGRAM_CHANNEL_LANG optional: ru (default), uz or en
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Kind = 'truck' | 'sale';

// The app also runs as a web build, and a browser will not POST here until a
// preflight OPTIONS has been answered with these. Repeated in each function on
// purpose; they are pasted into the dashboard one file at a time.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

/** Machine-readable reasons, matching `EdgeErrorCode` in lib/api.ts. */
function fail(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: JSON_HEADERS,
  });
}

const STRINGS = {
  ru: {
    truck: 'Новая машина',
    sale: 'Продажа',
    plate: 'Номер',
    fruit: 'Товар',
    boxes: 'ящиков',
    price: 'Цена за ящик',
    total: 'Сумма',
    customer: 'Покупатель',
    truckLabel: 'Машина',
    by: 'Добавил',
    soum: 'сум',
  },
  uz: {
    truck: 'Yangi mashina',
    sale: 'Sotuv',
    plate: 'Raqam',
    fruit: 'Mahsulot',
    boxes: 'quti',
    price: 'Quti narxi',
    total: 'Jami',
    customer: 'Xaridor',
    truckLabel: 'Mashina',
    by: "Qo'shdi",
    soum: "so'm",
  },
  en: {
    truck: 'New truck',
    sale: 'Sale',
    plate: 'Plate',
    fruit: 'Fruit',
    boxes: 'boxes',
    price: 'Price per box',
    total: 'Total',
    customer: 'Customer',
    truckLabel: 'Truck',
    by: 'Added by',
    soum: 'soum',
  },
} as const;

/** Grouped digits, matching how the app prints money. */
function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function line(label: string, value: string): string {
  return `${label}: <b>${value}</b>`;
}

function truckMessage(payload: Record<string, unknown>, t: typeof STRINGS['ru']): string {
  const boxes = Number(payload.boxes) || 0;
  const price = Number(payload.pricePerBox) || 0;
  return [
    `🚚 <b>${t.truck}</b>`,
    line(t.plate, esc(payload.truckNumber)),
    line(t.fruit, `${esc(payload.fruit)} · ${money(boxes)} ${t.boxes}`),
    line(t.price, `${money(price)} ${t.soum}`),
    line(t.total, `${money(boxes * price)} ${t.soum}`),
    `${t.by}: ${esc(payload.createdByName)}`,
  ].join('\n');
}

function saleMessage(payload: Record<string, unknown>, plate: string, t: typeof STRINGS['ru']): string {
  const boxes = Number(payload.boxesBought ?? payload.boxes) || 0;
  const price = Number(payload.pricePerBox) || 0;
  const rows = [
    `💰 <b>${t.sale}</b>`,
    line(t.customer, esc(payload.customerName) || '—'),
    line(t.fruit, `${esc(payload.fruit)} · ${money(boxes)} ${t.boxes}`),
    line(t.total, `${money(boxes * price)} ${t.soum}`),
  ];
  if (plate) rows.push(line(t.truckLabel, esc(plate)));
  rows.push(`${t.by}: ${esc(payload.createdByName)}`);
  return rows.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('bad_request', 405, 'Method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('unauthorized', 401, 'Sign in first');

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const channelId = Deno.env.get('TELEGRAM_CHANNEL_ID');
  if (!botToken || !channelId) {
    return fail('not_configured', 500, 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID are not set');
  }

  const lang = (Deno.env.get('TELEGRAM_CHANNEL_LANG') ?? 'ru') as keyof typeof STRINGS;
  const t = STRINGS[lang] ?? STRINGS.ru;

  const body = await req.json().catch(() => null);
  const kind = body?.kind === 'truck' || body?.kind === 'sale' ? (body.kind as Kind) : null;
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!kind || !id) return fail('bad_request', 400, 'kind and id are required');

  // The caller's own JWT, so trucks/sales RLS applies here exactly as it would
  // from the app.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // `sales` also grants customers read access to their own rows, so RLS alone
  // would let a customer announce their purchase. The channel is the owners'.
  //
  // The lookup must name the caller: an owner may read every profile, so an
  // unfiltered `select('role').maybeSingle()` matched several rows and returned
  // an error instead of a row. Every announcement was therefore rejected as
  // Forbidden, and nothing had ever been posted to the channel.
  const { data: auth } = await asCaller.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return fail('unauthorized', 401, 'Session is not valid');

  const { data: me } = await asCaller
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (me?.role !== 'owner') return fail('forbidden', 403, 'Only owners announce to the channel');

  const table = kind === 'truck' ? 'trucks' : 'sales';
  const { data: row } = await asCaller.from(table).select('payload').eq('id', id).maybeSingle();
  if (!row?.payload) return fail('not_found', 404, `No ${kind} with id ${id}`);

  const payload = row.payload as Record<string, unknown>;

  // Service role: the dedupe table denies everyone else by design.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Claim first, post second. Whoever wins the insert owns the announcement;
  // every other attempt for the same document leaves quietly.
  const { data: claim } = await admin
    .from('telegram_posts')
    .insert({ kind, doc_id: id })
    .select('doc_id')
    .maybeSingle();

  if (!claim) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { headers: JSON_HEADERS });
  }

  let text: string;
  if (kind === 'truck') {
    text = truckMessage(payload, t);
  } else {
    // Sales name their truck by id; the channel wants the plate. Missing is
    // fine — a sale can be recorded without one.
    const truckId = typeof payload.truckId === 'string' ? payload.truckId : null;
    let plate = '';
    if (truckId) {
      const { data: truck } = await asCaller
        .from('trucks')
        .select('payload')
        .eq('id', truckId)
        .maybeSingle();
      const truckPayload = truck?.payload as Record<string, unknown> | undefined;
      plate = typeof truckPayload?.truckNumber === 'string' ? truckPayload.truckNumber : '';
    }
    text = saleMessage(payload, plate, t);
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text,
      parse_mode: 'HTML',
      disable_notification: kind === 'sale',
    }),
  });

  const sent = await tgRes.json().catch(() => null);
  if (!tgRes.ok || !sent?.ok) {
    // Release the claim, or this document could never be announced again — the
    // usual cause is the bot not being an admin of the channel yet, which the
    // owner fixes and then retries.
    await admin.from('telegram_posts').delete().eq('kind', kind).eq('doc_id', id);
    const description = String(sent?.description ?? `HTTP ${tgRes.status}`);
    console.error('channel post failed', kind, id, description);
    return fail('telegram_failed', 502, description);
  }

  const messageId = sent.result?.message_id;
  if (typeof messageId === 'number') {
    await admin
      .from('telegram_posts')
      .update({ message_id: messageId })
      .eq('kind', kind)
      .eq('doc_id', id);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
});
