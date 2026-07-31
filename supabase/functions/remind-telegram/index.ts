// Deploy via: Supabase Dashboard -> Edge Functions, or `supabase functions deploy`.
//
// Chases customers for unpaid sales over Telegram, in Uzbek.
//
// Two ways in, one message:
//   POST { customerId, coords? }  an owner pressing WARN — chases that one
//                                 customer now, whatever the debt's age.
//   POST { sweep: true }          the schedule — chases everyone whose oldest
//                                 unpaid sale is older than REMIND_AFTER_DAYS
//                                 and who has not been chased recently.
//
// The wording is built here rather than in the app so the button and the sweep
// cannot drift apart, and so the figures always come from the books rather than
// from whatever a screen happened to be showing.
//
// Secrets:
//   TELEGRAM_BOT_TOKEN   the bot, shared with the other functions
//   CRON_SECRET          any long random string; the sweep must present it
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

/** A debt is left alone for this long before the bot says anything. */
const REMIND_AFTER_DAYS = 3;

/** And a customer is never chased more often than this. */
const QUIET_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

function fail(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), { status, headers: JSON_HEADERS });
}

function money(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "16-noyabr", the way the date is said out loud. */
function uzDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
}

interface Debt {
  customerId: string;
  amount: number;
  /** The oldest sale still unpaid — the one the message names. */
  oldestUnpaid: string;
}

/** What each customer still owes, from sales minus payments. */
function debts(sales: any[], payments: any[]): Map<string, Debt> {
  const paidBySale = new Map<string, number>();
  for (const row of payments) {
    const p = row.payload ?? {};
    const saleId = String(p.saleId ?? '');
    if (!saleId) continue;
    paidBySale.set(saleId, (paidBySale.get(saleId) ?? 0) + (Number(p.amount) || 0));
  }

  const out = new Map<string, Debt>();
  for (const row of sales) {
    const s = row.payload ?? {};
    const customerId = typeof s.customerId === 'string' ? s.customerId : '';
    if (!customerId) continue;

    const boxes = Number(s.boxesBought ?? s.boxes) || 0;
    const total = boxes * (Number(s.pricePerBox) || 0);
    const due = total - (paidBySale.get(row.id) ?? 0);
    if (due <= 0) continue;

    const createdAt = typeof s.createdAt === 'string' ? s.createdAt : row.updated_at;
    const held = out.get(customerId);
    if (held) {
      held.amount += due;
      if (createdAt < held.oldestUnpaid) held.oldestUnpaid = createdAt;
    } else {
      out.set(customerId, { customerId, amount: due, oldestUnpaid: createdAt });
    }
  }
  return out;
}

/**
 * The reminder, exactly as the owners wrote it. The location line is dropped
 * when there is no position to put in it — telling someone "you are currently"
 * and then nothing is worse than not mentioning it.
 */
function reminderText(
  name: string,
  debt: Debt,
  coords: { lat: number; lng: number } | null
): string {
  const lines = [
    `Assalomu alaykum, ${name}.`,
    `${uzDate(debt.oldestUnpaid)} sanasidagi ${money(debt.amount)} so'm to'lov hali qabul qilinmadi.`,
  ];
  if (coords) {
    lines.push(`Siz hozir ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
  }
  lines.push(
    "Iltimos, imkoniyat topib to'lovni amalga oshiring yoki biz bilan bog'laning — kerak bo'lsa muddatni kelishib olamiz.",
    'Hamkorligingiz uchun rahmat.'
  );
  return lines.join('\n');
}

async function send(botToken: string, chatId: number, text: string): Promise<string | null> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) return String(body?.description ?? `HTTP ${res.status}`);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('bad_request', 405, 'Method not allowed');

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) return fail('not_configured', 500, 'TELEGRAM_BOT_TOKEN is not set');

  const body = await req.json().catch(() => null);
  const sweep = body?.sweep === true;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // The sweep runs unattended, so it carries its own shared secret rather than
  // anyone's session. A one-customer call must come from a signed-in owner.
  if (sweep) {
    const expected = Deno.env.get('CRON_SECRET');
    if (!expected || req.headers.get('X-Cron-Secret') !== expected) {
      return fail('unauthorized', 401, 'Bad cron secret');
    }
  } else {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('unauthorized', 401, 'Sign in first');
    const asCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: auth } = await asCaller.auth.getUser();
    if (!auth.user) return fail('unauthorized', 401, 'Session is not valid');
    const { data: me } = await asCaller
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (me?.role !== 'owner') return fail('forbidden', 403, 'Owners only');
  }

  const [salesRes, paymentsRes, clientsRes] = await Promise.all([
    admin.from('sales').select('id, updated_at, payload').is('deleted_at', null),
    admin.from('payments').select('id, updated_at, payload').is('deleted_at', null),
    admin
      .from('clients')
      .select('id, name, customer_id, telegram_chat_id, last_reminded_at')
      .eq('kind', 'chat')
      .not('customer_id', 'is', null)
      .not('telegram_chat_id', 'is', null),
  ]);

  // Before migration 0009 the `kind` and `customer_id` columns do not exist, so
  // this query errors and every sweep looks like "nobody is linked". Say which
  // it is rather than leaving that to be guessed at.
  if (clientsRes.error) {
    console.error('client lookup failed', clientsRes.error.message);
    return fail(
      'not_configured',
      500,
      `Cannot read contacts — has migration 0009 been run? (${clientsRes.error.message})`
    );
  }

  const owed = debts(salesRes.data ?? [], paymentsRes.data ?? []);
  const contacts = clientsRes.data ?? [];

  const targets = sweep
    ? contacts
    : contacts.filter((c) => c.customer_id === (body?.customerId ?? ''));

  if (targets.length === 0) {
    // Nothing linked to this customer: the owner needs to know that, rather
    // than watch a button succeed silently having sent nothing.
    return fail(
      sweep ? 'not_found' : 'not_linked',
      sweep ? 404 : 409,
      'No Telegram contact is linked to that customer'
    );
  }

  const now = Date.now();
  const coords =
    body?.coords && typeof body.coords.lat === 'number' && typeof body.coords.lng === 'number'
      ? { lat: body.coords.lat as number, lng: body.coords.lng as number }
      : null;

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const contact of targets) {
    const debt = owed.get(contact.customer_id!);
    if (!debt || debt.amount <= 0) {
      skipped++;
      continue;
    }

    if (sweep) {
      const age = now - new Date(debt.oldestUnpaid).getTime();
      if (age < REMIND_AFTER_DAYS * DAY_MS) {
        skipped++;
        continue;
      }
      const last = contact.last_reminded_at ? new Date(contact.last_reminded_at).getTime() : 0;
      if (now - last < QUIET_DAYS * DAY_MS) {
        skipped++;
        continue;
      }
    }

    // The sweep has no live position to offer — that only exists in the moment
    // an owner presses WARN and the customer's device answers.
    let position = coords;
    if (!position) {
      const { data: known } = await admin
        .from('customer_locations')
        .select('lat, lng')
        .eq('user_id', contact.customer_id!)
        .maybeSingle();
      if (known) position = { lat: Number(known.lat), lng: Number(known.lng) };
    }

    const error = await send(
      botToken,
      contact.telegram_chat_id!,
      reminderText(contact.name || '', debt, position)
    );

    if (error) {
      console.error('reminder failed', contact.id, error);
      failures.push(error);
      continue;
    }

    sent++;
    await admin
      .from('clients')
      .update({ last_reminded_at: new Date().toISOString() })
      .eq('id', contact.id);
  }

  if (sent === 0 && failures.length > 0) {
    return fail('telegram_failed', 502, failures[0]!);
  }
  if (sent === 0 && !sweep) {
    // A single-customer call that sent nothing means the debt is already clear.
    return fail('nothing_owed', 409, 'That customer owes nothing');
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped }), { headers: JSON_HEADERS });
});
