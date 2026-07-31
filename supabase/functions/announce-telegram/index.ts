// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// Posts a line in the Telegram channel whenever an owner adds a truck, records
// a sale, or takes money back against a debt. Called by the app (lib/api.ts
// `announceToChannel`) with the owner's session token attached automatically by
// supabase-js.
//
// The caller sends only a kind and an id — never the text. The message is built
// here from the row as the database has it, read back under the caller's own
// JWT, so a client cannot announce a sale that does not exist or inflate the
// figures in one that does.
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN    the bot, shared with the other two functions
//   TELEGRAM_CHANNEL_ID   e.g. -1001234567890 — see tools/telegram, `channel`
//   TELEGRAM_CHANNEL_LANG optional: ru (default) or uz. The bot has no English.
//   REPORT_UTC_OFFSET     hours ahead of UTC the clock runs at (default 5), so
//                         "came at 14:20" is the time anyone there saw
//
// Groups additionally get the day read against yesterday, as a banner with a
// picture. Set whichever of these you have; a direction with no picture is
// posted as text, so none of them is required:
//   TELEGRAM_IMAGE_UP     growth — an https URL, or a Telegram file_id
//   TELEGRAM_IMAGE_DOWN   a drop
//   TELEGRAM_IMAGE_FLAT   level, or the first sale of the day
//   TELEGRAM_TREND_MIN    percent that counts as a move at all (default 5)
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Kind = 'truck' | 'sale' | 'payment';

/**
 * The bucket every anonymous sale attaches to — see `RANDOM_CUSTOMER_ID` in
 * lib/api.ts. Those sales are settled the instant they are written, and
 * announcing each of those settlements as "the debt came back" would fill the
 * group with news about a debt that never existed. The app already asks for
 * silence on them; this is the guard that does not depend on it doing so.
 */
const RANDOM_CUSTOMER_ID = 'cust_random';

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

/**
 * Russian and Uzbek only. English was carried here because the app has three
 * languages, but the app's languages are what an *owner* reads on a screen —
 * the groups and the channel are read by drivers and buyers, and none of them
 * asked for English. `TELEGRAM_CHANNEL_LANG=en` now resolves to Russian.
 */
const STRINGS = {
  ru: {
    truck: 'Новая машина',
    truckCame: 'Пришла',
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
    astatka: 'Остаток всего',
    today: 'Сегодня',
    yesterday: 'вчера',
    gotMoney: 'Принял',
    up: 'Продажи растут',
    down: 'Продажи падают',
    flat: 'Наравне со вчера',
    first: 'Первая продажа за день',
    // A debt coming back is its own kind of news, so it gets its own words.
    repaid: 'Долг возвращён',
    repaidBy: '{name} вернул долг',
    when: 'Когда',
    amount: 'Сумма',
    stillOwes: 'Осталось',
    debtClosed: 'Долг закрыт полностью',
    /** Russian puts the preposition in front of the clock; Uzbek puts it after. */
    atTime: 'в {time}',
    days: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
    months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  },
  uz: {
    truck: 'Yangi mashina',
    truckCame: 'Keldi',
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
    astatka: 'Astatka jami',
    today: 'Bugun',
    yesterday: 'kecha',
    gotMoney: 'Qabul qildi',
    up: "Sotuv o'smoqda",
    down: 'Sotuv tushmoqda',
    flat: 'Kechagidek',
    first: 'Bugungi birinchi sotuv',
    repaid: 'Qarz qaytarildi',
    repaidBy: '{name} qarzini qaytardi',
    when: 'Qachon',
    amount: 'Summa',
    stillOwes: 'Qoldi',
    debtClosed: "Qarz to'liq yopildi",
    atTime: '{time} da',
    days: ['yak', 'dush', 'sesh', 'chor', 'pay', 'jum', 'shan'],
    months: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
             'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  },
};

/**
 * Derived from the Russian block, which makes it the source of truth: a key
 * missing from `uz` fails where that block is assigned to `Words` below.
 */
type Words = typeof STRINGS['ru'];

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

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

/**
 * The wall clock the business runs on.
 *
 * Everything stored is UTC, and a group reading "пришла в 09:20" about a truck
 * that arrived at 14:20 would rightly conclude the bot is broken. Uzbekistan is
 * UTC+5 and does not observe daylight saving, so a fixed offset is exact rather
 * than an approximation — `REPORT_UTC_OFFSET` carries it, shared with the
 * report function.
 */
function localParts(iso: string | undefined, offsetHours: number) {
  const ms = iso ? new Date(iso).getTime() : Date.now();
  const d = new Date((Number.isFinite(ms) ? ms : Date.now()) + offsetHours * 3600_000);
  return {
    weekday: d.getUTCDay(),
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    hhmm: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

/** "в 14:20", or "31 июля, в 14:20" when the day is worth naming too. */
function stamp(iso: string | undefined, offsetHours: number, t: Words, withDate: boolean): string {
  const p = localParts(iso, offsetHours);
  const clock = fill(t.atTime, { time: p.hhmm });
  return withDate ? `${p.day} ${t.months[p.month]}, ${clock}` : clock;
}

function truckMessage(
  payload: Record<string, unknown>,
  t: Words,
  offsetHours: number
): string {
  const boxes = Number(payload.boxes) || 0;
  const price = Number(payload.pricePerBox) || 0;
  const arrived = typeof payload.createdAt === 'string' ? payload.createdAt : undefined;
  return [
    `🚚 <b>${t.truck}</b>`,
    // The time it turned up, which is the first thing anyone in the group asks.
    line(t.truckCame, stamp(arrived, offsetHours, t, false)),
    line(t.plate, esc(payload.truckNumber)),
    line(t.fruit, `${esc(payload.fruit)} · ${money(boxes)} ${t.boxes}`),
    line(t.price, `${money(price)} ${t.soum}`),
    line(t.total, `${money(boxes * price)} ${t.soum}`),
    `${t.by}: ${esc(payload.createdByName)}`,
  ].join('\n');
}

/**
 * The running picture the groups get under each sale: what is still owed
 * across everyone, and whether today is beating yesterday.
 *
 * Days are cut at local midnight, not UTC — Uzbekistan is UTC+5, so a UTC day
 * would roll over at five in the morning and put the first sales of a market
 * day into the previous one.
 */
function summarise(sales: any[], payments: any[], offsetHours: number) {
  const paidBySale = new Map<string, number>();
  for (const row of payments) {
    const p = row.payload ?? {};
    const id = String(p.saleId ?? '');
    if (id) paidBySale.set(id, (paidBySale.get(id) ?? 0) + (Number(p.amount) || 0));
  }

  const shift = offsetHours * 3600_000;
  const dayOf = (iso: string) => Math.floor((new Date(iso).getTime() + shift) / 86_400_000);
  const today = Math.floor((Date.now() + shift) / 86_400_000);

  let outstanding = 0;
  let todayTotal = 0;
  let yesterdayTotal = 0;

  for (const row of sales) {
    const s = row.payload ?? {};
    const total = (Number(s.boxesBought ?? s.boxes) || 0) * (Number(s.pricePerBox) || 0);
    outstanding += Math.max(0, total - (paidBySale.get(row.id) ?? 0));

    const day = dayOf(typeof s.createdAt === 'string' ? s.createdAt : row.updated_at);
    if (day === today) todayTotal += total;
    else if (day === today - 1) yesterdayTotal += total;
  }

  return { outstanding, todayTotal, yesterdayTotal };
}

type Direction = 'up' | 'down' | 'flat' | 'first';

interface Trend {
  direction: Direction;
  /** Percent against yesterday, signed. Zero when there is nothing to compare. */
  change: number;
}

/**
 * Which way the day is going, as one of four cases.
 *
 * A threshold rather than a bare sign, because a market day that lands within a
 * few percent of the last one has not grown or shrunk — it is the same day, and
 * calling that "sales are up" twice a week is how a banner stops being read.
 */
function readTrend(todayTotal: number, yesterdayTotal: number, minPercent: number): Trend {
  if (yesterdayTotal <= 0) return { direction: 'first', change: 0 };

  const change = Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100);
  if (Math.abs(change) < minPercent) return { direction: 'flat', change };
  return { direction: change > 0 ? 'up' : 'down', change };
}

const BANNER: Record<Direction, string> = {
  up: '📈',
  down: '📉',
  flat: '➖',
  first: '🌅',
};

function trendLine(
  sums: { todayTotal: number; yesterdayTotal: number },
  trend: Trend,
  t: Words
): string {
  const head = `${t.today}: <b>${money(sums.todayTotal)} ${t.soum}</b>`;
  if (trend.direction === 'first') return head;

  const arrow = trend.change > 0 ? '▲' : trend.change < 0 ? '▼' : '=';
  return `${head} ${arrow} ${Math.abs(trend.change)}% (${t.yesterday} ${money(sums.yesterdayTotal)})`;
}

/** The picture for this direction, if the owner has set one. */
function imageFor(direction: Direction): string | null {
  const key =
    direction === 'up'
      ? 'TELEGRAM_IMAGE_UP'
      : direction === 'down'
        ? 'TELEGRAM_IMAGE_DOWN'
        : 'TELEGRAM_IMAGE_FLAT';
  return Deno.env.get(key)?.trim() || null;
}

function saleMessage(payload: Record<string, unknown>, plate: string, t: Words): string {
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
  if (!botToken) return fail('not_configured', 500, 'TELEGRAM_BOT_TOKEN is not set');

  // The channel is optional. It used to be required alongside the token, which
  // meant a project with groups but no channel announced nothing anywhere —
  // and said so only in a log line nobody reads.
  const channelId = Deno.env.get('TELEGRAM_CHANNEL_ID') || null;

  // Russian unless Uzbek is asked for by name — English is gone, so an old
  // `en` in the secret quietly resolves to Russian rather than crashing.
  const t: Words = Deno.env.get('TELEGRAM_CHANNEL_LANG') === 'uz' ? STRINGS.uz : STRINGS.ru;
  const offsetHours = Number(Deno.env.get('REPORT_UTC_OFFSET') ?? '5');

  const body = await req.json().catch(() => null);
  const kind =
    body?.kind === 'truck' || body?.kind === 'sale' || body?.kind === 'payment'
      ? (body.kind as Kind)
      : null;
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
    .select('role, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (me?.role !== 'owner') return fail('forbidden', 403, 'Only owners announce to the channel');

  const table = kind === 'truck' ? 'trucks' : kind === 'sale' ? 'sales' : 'payments';
  const { data: row } = await asCaller.from(table).select('payload').eq('id', id).maybeSingle();
  if (!row?.payload) return fail('not_found', 404, `No ${kind} with id ${id}`);

  const payload = row.payload as Record<string, unknown>;

  // Service role: the dedupe table denies everyone else by design.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // A repayment names the person and the debt they still carry, and neither
  // lives on the payment — it holds only a sale id and an amount. Resolved
  // before the claim below, so a payment that turns out not to be news never
  // burns its dedupe row.
  let repayment: { customerName: string; remaining: number } | null = null;

  if (kind === 'payment') {
    const saleId = typeof payload.saleId === 'string' ? payload.saleId : '';
    const { data: saleRow } = await asCaller
      .from('sales')
      .select('payload')
      .eq('id', saleId)
      .maybeSingle();

    const sale = (saleRow?.payload ?? {}) as Record<string, unknown>;
    const customerId = typeof sale.customerId === 'string' ? sale.customerId : '';

    // Nothing to announce: a walk-up buyer who paid as they bought never owed
    // anything, and a sale that has gone leaves no one to name.
    if (!customerId || customerId === RANDOM_CUSTOMER_ID) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: JSON_HEADERS });
    }

    // What they still owe *after* this payment, straight from the books rather
    // than from whatever the screen that recorded it happened to be showing.
    const [salesRes, paymentsRes] = await Promise.all([
      admin.from('sales').select('id, payload').is('deleted_at', null),
      admin.from('payments').select('id, payload').is('deleted_at', null),
    ]);

    const paidBySale = new Map<string, number>();
    for (const p of paymentsRes.data ?? []) {
      const pay = (p.payload ?? {}) as Record<string, unknown>;
      const key = String(pay.saleId ?? '');
      if (key) paidBySale.set(key, (paidBySale.get(key) ?? 0) + (Number(pay.amount) || 0));
    }

    let remaining = 0;
    for (const s of salesRes.data ?? []) {
      const doc = (s.payload ?? {}) as Record<string, unknown>;
      if (doc.customerId !== customerId) continue;
      const boxes = Number(doc.boxesBought ?? doc.boxes) || 0;
      remaining += Math.max(0, boxes * (Number(doc.pricePerBox) || 0) - (paidBySale.get(s.id) ?? 0));
    }

    repayment = { customerName: String(sale.customerName ?? '').trim(), remaining };
  }

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
    text = truckMessage(payload, t, offsetHours);
  } else if (kind === 'payment') {
    const rows = [
      `💸 <b>${fill(t.repaidBy, { name: esc(repayment?.customerName) || '—' })}</b>`,
      line(t.amount, `${money(payload.amount)} ${t.soum}`),
      line(
        t.when,
        stamp(typeof payload.createdAt === 'string' ? payload.createdAt : undefined, offsetHours, t, true)
      ),
      (repayment?.remaining ?? 0) > 0
        ? line(t.stillOwes, `${money(repayment!.remaining)} ${t.soum}`)
        : `✅ ${t.debtClosed}`,
    ];
    if (me?.full_name) rows.push(`${t.gotMoney}: ${esc(me.full_name)}`);
    text = rows.join('\n');
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

  // Groups get everything the channel gets, and a sale carries the running
  // picture with it: what is owed across everyone, and today against yesterday
  // — headlined as growth or as a drop, because that is the line anyone
  // scrolling a group chat actually stops on.
  let groupText = text;
  let groupImage: string | null = null;
  if (kind === 'sale') {
    const [salesRes, paymentsRes] = await Promise.all([
      admin.from('sales').select('id, updated_at, payload').is('deleted_at', null),
      admin.from('payments').select('id, updated_at, payload').is('deleted_at', null),
    ]);
    const offset = Number(Deno.env.get('REPORT_UTC_OFFSET') ?? '5');
    const sums = summarise(salesRes.data ?? [], paymentsRes.data ?? [], offset);

    const minPercent = Math.max(0, Number(Deno.env.get('TELEGRAM_TREND_MIN') ?? '5') || 0);
    const trend = readTrend(sums.todayTotal, sums.yesterdayTotal, minPercent);
    groupImage = imageFor(trend.direction);

    groupText = [
      text,
      '➖➖➖➖➖➖➖',
      `${BANNER[trend.direction]} <b>${t[trend.direction]}</b>`,
      trendLine(sums, trend, t),
      line(t.astatka, `${money(sums.outstanding)} ${t.soum}`),
    ].join('\n');
  }

  const post = (chatId: string | number, body: string) =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: 'HTML',
        disable_notification: kind === 'sale',
      }),
    });

  /**
   * The same message with a picture over it. A caption is capped at 1024
   * characters where a message is capped at 4096 — ours is nowhere near either,
   * but a truncated caption would be silently wrong, so it is checked.
   */
  const postPhoto = (chatId: string | number, photo: string, caption: string) =>
    fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption,
        parse_mode: 'HTML',
        disable_notification: kind === 'sale',
      }),
    });

  // A missing `clients` table or `kind` column (migration 0009 not run yet)
  // must not take the channel post down with it.
  const groupsRes = await admin
    .from('clients')
    .select('id, telegram_chat_id')
    .eq('kind', 'group')
    .not('telegram_chat_id', 'is', null);

  if (groupsRes.error) console.error('group lookup failed', groupsRes.error.message);
  const groups = groupsRes.data ?? [];

  if (!channelId && groups.length === 0) {
    await admin.from('telegram_posts').delete().eq('kind', kind).eq('doc_id', id);
    return fail(
      'not_configured',
      500,
      'Nowhere to post: set TELEGRAM_CHANNEL_ID, or connect a group contact'
    );
  }

  let delivered = 0;
  const problems: string[] = [];
  let channelMessageId: number | null = null;

  if (channelId) {
    try {
      const res = await post(channelId, text);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        delivered++;
        if (typeof body.result?.message_id === 'number') channelMessageId = body.result.message_id;
      } else {
        const description = String(body?.description ?? `HTTP ${res.status}`);
        console.error('channel post failed', kind, id, description);
        problems.push(description);
      }
    } catch (err) {
      problems.push(String(err));
    }
  }

  // A caption longer than Telegram allows would come back truncated rather than
  // refused, so the picture is dropped instead of the words being cut.
  const usePhoto = groupImage !== null && groupText.length <= 1024;

  // One group the bot was removed from must not stop the rest going out.
  for (const group of groups) {
    try {
      let res = usePhoto
        ? await postPhoto(group.telegram_chat_id!, groupImage!, groupText)
        : await post(group.telegram_chat_id!, groupText);
      let body = await res.json().catch(() => null);

      // A picture Telegram will not fetch — a dead URL, a host it cannot reach,
      // a file too large — must not cost the group the sale itself.
      if (usePhoto && !(res.ok && body?.ok)) {
        console.error('group photo failed, falling back to text', group.id, body?.description);
        res = await post(group.telegram_chat_id!, groupText);
        body = await res.json().catch(() => null);
      }

      if (res.ok && body?.ok) delivered++;
      else {
        const description = String(body?.description ?? `HTTP ${res.status}`);
        console.error('group post failed', group.id, description);
        problems.push(description);
      }
    } catch (err) {
      console.error('group post threw', group.id, err);
      problems.push(String(err));
    }
  }

  if (delivered === 0) {
    // Release the claim, or this document could never be announced again — the
    // usual cause is the bot not being an admin yet, which the owner fixes and
    // then retries.
    await admin.from('telegram_posts').delete().eq('kind', kind).eq('doc_id', id);
    return fail('telegram_failed', 502, problems[0] ?? 'Nothing was delivered');
  }

  if (channelMessageId !== null) {
    await admin
      .from('telegram_posts')
      .update({ message_id: channelMessageId })
      .eq('kind', kind)
      .eq('doc_id', id);
  }

  return new Response(JSON.stringify({ ok: true, delivered, problems: problems.length }), {
    headers: JSON_HEADERS,
  });
});
