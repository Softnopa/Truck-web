// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// The Growth button. An owner presses it, and every linked group gets the day
// read against the one before it — posted, and pinned, so it sits at the top of
// the group instead of scrolling away under the next sale.
//
// Nothing about the wording comes from the app. The caller sends an empty body;
// the figures are read here, from the books, under the service role — so what
// the group sees is what the database says, and two owners pressing it a minute
// apart cannot produce two different numbers.
//
// Secrets (shared with announce-telegram):
//   TELEGRAM_BOT_TOKEN     the bot
//   TELEGRAM_CHANNEL_LANG  optional: ru (default), uz or en
//   TELEGRAM_IMAGE_UP / _DOWN / _FLAT   optional pictures per direction
//   TELEGRAM_TREND_MIN     percent that counts as a move at all (default 5)
//   REPORT_UTC_OFFSET      hours ahead of UTC the day is cut at (default 5)
//
// Pinning needs the bot to be an **admin** of the group with "Pin messages".
// Without it the post still goes out and only the pin is skipped — the report
// is the point, the pin is a nicety.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

function fail(code: string, status: number, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), { status, headers: JSON_HEADERS });
}

const STRINGS = {
  ru: {
    title: 'Отчёт по продажам',
    today: 'Сегодня',
    yesterday: 'Вчера',
    sales: 'Продаж сегодня',
    astatka: 'Остаток всего',
    soum: 'сум',
    up: 'Продажи растут',
    down: 'Продажи падают',
    flat: 'Наравне со вчера',
    first: 'Первая продажа за день',
    quiet: 'Сегодня продаж пока нет',
    best: 'Лучший покупатель',
  },
  uz: {
    title: 'Sotuv hisoboti',
    today: 'Bugun',
    yesterday: 'Kecha',
    sales: 'Bugungi sotuvlar',
    astatka: 'Astatka jami',
    soum: "so'm",
    up: "Sotuv o'smoqda",
    down: 'Sotuv tushmoqda',
    flat: 'Kechagidek',
    first: 'Bugungi birinchi sotuv',
    quiet: "Bugun hali sotuv yo'q",
    best: 'Eng yaxshi xaridor',
  },
  en: {
    title: 'Sales report',
    today: 'Today',
    yesterday: 'Yesterday',
    sales: 'Sales today',
    astatka: 'Outstanding total',
    soum: 'soum',
    up: 'Sales are up',
    down: 'Sales are down',
    flat: 'Level with yesterday',
    first: 'First sale of the day',
    quiet: 'No sales yet today',
    best: 'Best customer',
  },
} as const;

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

type Direction = 'up' | 'down' | 'flat' | 'first';

const BANNER: Record<Direction, string> = { up: '📈', down: '📉', flat: '➖', first: '🌅' };

/**
 * The day so far, cut at local midnight rather than UTC — Uzbekistan is UTC+5,
 * so a UTC day would roll over at five in the morning and file the first sales
 * of a market day under the previous one.
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
  let todayCount = 0;
  const byCustomer = new Map<string, number>();

  for (const row of sales) {
    const s = row.payload ?? {};
    const total = (Number(s.boxesBought ?? s.boxes) || 0) * (Number(s.pricePerBox) || 0);
    outstanding += Math.max(0, total - (paidBySale.get(row.id) ?? 0));

    const day = dayOf(typeof s.createdAt === 'string' ? s.createdAt : row.updated_at);
    if (day === today) {
      todayTotal += total;
      todayCount++;
      const who = String(s.customerName ?? '').trim();
      if (who) byCustomer.set(who, (byCustomer.get(who) ?? 0) + total);
    } else if (day === today - 1) {
      yesterdayTotal += total;
    }
  }

  let best: { name: string; total: number } | null = null;
  for (const [name, total] of byCustomer) {
    if (!best || total > best.total) best = { name, total };
  }

  return { outstanding, todayTotal, yesterdayTotal, todayCount, best };
}

function readTrend(todayTotal: number, yesterdayTotal: number, minPercent: number) {
  if (yesterdayTotal <= 0) return { direction: 'first' as Direction, change: 0 };
  const change = Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100);
  if (Math.abs(change) < minPercent) return { direction: 'flat' as Direction, change };
  return { direction: (change > 0 ? 'up' : 'down') as Direction, change };
}

function imageFor(direction: Direction): string | null {
  const key =
    direction === 'up'
      ? 'TELEGRAM_IMAGE_UP'
      : direction === 'down'
        ? 'TELEGRAM_IMAGE_DOWN'
        : 'TELEGRAM_IMAGE_FLAT';
  return Deno.env.get(key)?.trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('bad_request', 405, 'Method not allowed');

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) return fail('not_configured', 500, 'TELEGRAM_BOT_TOKEN is not set');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('unauthorized', 401, 'Sign in first');

  // Owners only. `sales` grants customers read access to their own rows, so RLS
  // alone would let a customer publish the day's takings to the groups.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: auth } = await asCaller.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return fail('unauthorized', 401, 'Session is not valid');

  const { data: me } = await asCaller.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (me?.role !== 'owner') return fail('forbidden', 403, 'Owners only');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const lang = (Deno.env.get('TELEGRAM_CHANNEL_LANG') ?? 'ru') as keyof typeof STRINGS;
  const t = STRINGS[lang] ?? STRINGS.ru;

  const groupsRes = await admin
    .from('clients')
    .select('id, name, telegram_chat_id')
    .eq('kind', 'group')
    .not('telegram_chat_id', 'is', null);

  if (groupsRes.error) {
    return fail(
      'not_configured',
      500,
      `Cannot read groups — has migration 0009 been run? (${groupsRes.error.message})`
    );
  }

  const groups = groupsRes.data ?? [];
  if (groups.length === 0) {
    // Nothing to post to. The owner needs to hear that rather than watch a
    // button succeed having reached nobody.
    return fail('not_linked', 409, 'No Telegram group is connected yet');
  }

  const [salesRes, paymentsRes] = await Promise.all([
    admin.from('sales').select('id, updated_at, payload').is('deleted_at', null),
    admin.from('payments').select('id, updated_at, payload').is('deleted_at', null),
  ]);

  const offset = Number(Deno.env.get('REPORT_UTC_OFFSET') ?? '5');
  const sums = summarise(salesRes.data ?? [], paymentsRes.data ?? [], offset);

  const minPercent = Math.max(0, Number(Deno.env.get('TELEGRAM_TREND_MIN') ?? '5') || 0);
  const trend = readTrend(sums.todayTotal, sums.yesterdayTotal, minPercent);
  const photo = imageFor(trend.direction);

  const arrow = trend.change > 0 ? '▲' : trend.change < 0 ? '▼' : '=';
  const rows = [
    `🏆 <b>${t.title}</b>`,
    '➖➖➖➖➖➖➖',
    `${BANNER[trend.direction]} <b>${t[trend.direction]}</b>`,
    line(t.today, `${money(sums.todayTotal)} ${t.soum}`),
  ];

  if (trend.direction !== 'first') {
    rows.push(
      line(t.yesterday, `${money(sums.yesterdayTotal)} ${t.soum} ${arrow} ${Math.abs(trend.change)}%`)
    );
  }

  rows.push(line(t.sales, String(sums.todayCount)));
  if (sums.best) {
    rows.push(line(t.best, `${esc(sums.best.name)} · ${money(sums.best.total)} ${t.soum}`));
  }
  if (sums.todayCount === 0) rows.push(t.quiet);
  rows.push('➖➖➖➖➖➖➖', line(t.astatka, `${money(sums.outstanding)} ${t.soum}`));

  const text = rows.join('\n');

  const call = (method: string, body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // A caption longer than Telegram allows comes back truncated rather than
  // refused, so past that length the picture is dropped, never the figures.
  const withPhoto = photo !== null && text.length <= 1024;

  let delivered = 0;
  let pinned = 0;
  const problems: string[] = [];

  for (const group of groups) {
    const chatId = group.telegram_chat_id!;
    try {
      let res = withPhoto
        ? await call('sendPhoto', { chat_id: chatId, photo, caption: text, parse_mode: 'HTML' })
        : await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
      let body = await res.json().catch(() => null);

      // A picture Telegram will not fetch must not cost the group the report.
      if (withPhoto && !body?.ok) {
        console.error('report photo failed, falling back to text', group.id, body?.description);
        res = await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
        body = await res.json().catch(() => null);
      }

      if (!body?.ok) {
        const description = String(body?.description ?? `HTTP ${res.status}`);
        console.error('report failed', group.id, description);
        problems.push(description);
        continue;
      }

      delivered++;
      const messageId: number | null =
        typeof body.result?.message_id === 'number' ? body.result.message_id : null;
      if (messageId === null) continue;

      // Replace the pin rather than stack one on top of the last, so the group
      // has exactly one report pinned: the current one.
      const { data: previous } = await admin
        .from('telegram_posts')
        .select('message_id')
        .eq('kind', 'report')
        .eq('doc_id', String(chatId))
        .maybeSingle();

      if (previous?.message_id) {
        await call('unpinChatMessage', { chat_id: chatId, message_id: previous.message_id }).catch(
          () => undefined
        );
      }

      const pin = await call('pinChatMessage', {
        chat_id: chatId,
        message_id: messageId,
        disable_notification: false,
      });
      const pinBody = await pin.json().catch(() => null);

      if (pinBody?.ok) {
        pinned++;
        await admin
          .from('telegram_posts')
          .upsert(
            { kind: 'report', doc_id: String(chatId), message_id: messageId, posted_at: new Date().toISOString() },
            { onConflict: 'kind,doc_id' }
          );
      } else {
        // Almost always "not enough rights": the bot is a member, not an admin.
        // The report is already in the group, so this is worth reporting back
        // without calling the whole thing a failure.
        console.error('pin failed', group.id, pinBody?.description);
        problems.push(String(pinBody?.description ?? 'pin failed'));
      }
    } catch (err) {
      console.error('report threw', group.id, err);
      problems.push(String(err));
    }
  }

  if (delivered === 0) {
    return fail('telegram_failed', 502, problems[0] ?? 'Nothing was delivered');
  }

  return new Response(JSON.stringify({ ok: true, delivered, pinned, problems: problems.length }), {
    headers: JSON_HEADERS,
  });
});
