// Deploy via: Supabase Dashboard -> Edge Functions -> Create a function -> paste this file.
//
// The Growth button. An owner presses it, and every linked group gets the whole
// day as a dashboard — posted, and pinned, so the state of trade sits at the
// top of the chat instead of scrolling away under the next sale.
//
// Nothing about the wording comes from the app. The caller sends a language and
// nothing else; every figure is read here, from the books, under the service
// role — so what the group sees is what the database says, and two owners
// pressing it a minute apart cannot produce two different numbers.
//
// Deliberately posted as text rather than with a picture. The dashboard runs
// past Telegram's 1024-character limit for a photo caption, and a caption that
// long comes back truncated rather than refused — the figures would be cut off
// mid-report. Per-sale announcements keep their up/down pictures; see
// announce-telegram.
//
// Secrets (shared with announce-telegram unless marked):
//   TELEGRAM_BOT_TOKEN     the bot
//   TELEGRAM_CHANNEL_LANG  ru (default) or uz — the fallback when the app sends
//                          no language of its own
//   REPORT_UTC_OFFSET      hours ahead of UTC the day is cut at (default 5)
//   TELEGRAM_DAILY_GOAL    the day's target in soum (default 60000000)   [new]
//   TELEGRAM_DAY_CLOSES_AT hour trading stops, 0-24, local (default 24)  [new]
//   TELEGRAM_LOW_STOCK_PCT a truck under this much left is "running out"
//                          (default 20)                                 [new]
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

const DAY_MS = 86_400_000;

// --- words -------------------------------------------------------------------

const STRINGS = {
  ru: {
    title: 'ОТЧЁТ ПО ПРОДАЖАМ',
    today: 'СЕГОДНЯ',
    sales: 'продаж',
    goal: 'ЦЕЛЬ ДНЯ',
    left: 'Осталось',
    goalDone: 'Цель дня выполнена!',
    untilClose: 'до закрытия',
    closed: 'торговый день закрыт',
    hourShort: 'ч',
    minShort: 'м',
    needPerHour: 'Нужно ~{n} сум/час',
    compare: 'СРАВНЕНИЕ',
    yesterday: 'Вчера',
    weekAvg: 'Ср. за неделю',
    record: 'Рекорд',
    week: 'НЕДЕЛЯ',
    now: '← сейчас',
    weekTotal: 'Итого',
    vsLastWeek: 'к прошлой неделе',
    streak: 'СТРИК',
    streakDays: '{n} дней с продажами',
    streakRisk: 'Сегодня стрик под угрозой!',
    streakNone: 'Стрика нет — начните сегодня',
    topGoods: 'ТОП ТОВАРОВ (неделя)',
    noGoods: 'На этой неделе продаж ещё не было',
    stock: 'СКЛАД',
    stockLeft: 'Остаток',
    runningOut: '{n} позиций заканчиваются',
    soum: 'сум',
    mln: 'млн',
    firstSaleWas: 'День только начался — вчера первая продажа была в {time}. Всё впереди 💪',
    quietDay: 'Сегодня продаж пока нет, и вчера в это время тоже было тихо.',
    goingWell: 'Идём с опережением вчерашнего дня. Так держать 💪',
    behind: 'Отстаём от вчерашнего. Ещё есть время наверстать.',
    days: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  },
  uz: {
    title: 'SOTUV HISOBOTI',
    today: 'BUGUN',
    sales: 'sotuv',
    goal: 'KUNLIK MAQSAD',
    left: 'Qoldi',
    goalDone: 'Kunlik maqsad bajarildi!',
    untilClose: 'yopilishgacha',
    closed: 'savdo kuni yopildi',
    hourShort: 's',
    minShort: 'd',
    needPerHour: 'Soatiga ~{n} so‘m kerak',
    compare: 'TAQQOSLASH',
    yesterday: 'Kecha',
    weekAvg: "Hafta o‘rtachasi",
    record: 'Rekord',
    week: 'HAFTA',
    now: '← hozir',
    weekTotal: 'Jami',
    vsLastWeek: "o‘tgan haftaga nisbatan",
    streak: 'SERIYA',
    streakDays: '{n} kun sotuv bilan',
    streakRisk: 'Bugun seriya xavf ostida!',
    streakNone: "Seriya yo‘q — bugundan boshlang",
    topGoods: 'TOP MAHSULOTLAR (hafta)',
    noGoods: "Bu hafta hali sotuv bo‘lmadi",
    stock: 'OMBOR',
    stockLeft: 'Qoldiq',
    runningOut: '{n} ta pozitsiya tugayapti',
    soum: "so‘m",
    mln: 'mln',
    firstSaleWas: "Kun endi boshlandi — kecha birinchi sotuv {time} da bo‘lgan. Hammasi oldinda 💪",
    quietDay: "Bugun hali sotuv yo‘q, kecha ham bu paytda tinch edi.",
    goingWell: "Kechagidan oldindamiz. Shu ruhda 💪",
    behind: "Kechagidan ortdamiz. Yetib olishga vaqt bor.",
    days: ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'],
    months: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
             'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  },
} as const;

type Lang = keyof typeof STRINGS;
type Words = typeof STRINGS['ru'];

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

// --- formatting --------------------------------------------------------------

/** Grouped digits, matching how the app prints money. */
function money(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "52.1" — the week chart is read at a glance, not audited. */
function millions(value: number): string {
  return (value / 1_000_000).toFixed(1);
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * "Вчера ......... 67 830 000". Block characters and dot leaders both line up
 * well enough in Telegram's font, and a <pre> block — the only way to get true
 * monospace — would wrap the whole report in a grey slab.
 */
function leader(label: string, value: string, width = 16): string {
  const dots = Math.max(1, width - label.length);
  return `   ${label} ${'.'.repeat(dots)} ${value}`;
}

/** Ten cells of progress. Clamped, so 140% of the goal does not overflow. */
function meter(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/** The week chart's bars, scaled against the best day in the week. */
function bar(value: number, max: number, width = 10): string {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// --- the books ---------------------------------------------------------------

interface Sale {
  /** Local day index — see `dayOf`. */
  day: number;
  /** Minutes past local midnight, for "the first sale was at". */
  minute: number;
  total: number;
  fruit: string;
}

/**
 * Days are cut at local midnight, not UTC. Uzbekistan is UTC+5, so a UTC day
 * would roll over at five in the morning and file the first sales of a market
 * day under the previous one.
 */
function makeClock(offsetHours: number) {
  const shift = offsetHours * 3600_000;
  const local = (ms: number) => new Date(ms + shift);
  return {
    dayOf: (ms: number) => Math.floor((ms + shift) / DAY_MS),
    minuteOf: (ms: number) => {
      const d = local(ms);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    },
    /** A Date whose UTC fields read as the local wall clock. */
    local,
  };
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

  // The app picks the language; the secret is only the fallback for a caller
  // that does not say (the scheduled sweep, an older build).
  const body = await req.json().catch(() => null);
  const asked = typeof body?.lang === 'string' ? body.lang : '';
  const lang: Lang =
    asked === 'ru' || asked === 'uz'
      ? asked
      : ((Deno.env.get('TELEGRAM_CHANNEL_LANG') === 'uz' ? 'uz' : 'ru') as Lang);
  const t: Words = STRINGS[lang];

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

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

  const [salesRes, trucksRes] = await Promise.all([
    admin.from('sales').select('id, updated_at, payload').is('deleted_at', null),
    admin.from('trucks').select('id, updated_at, payload').is('deleted_at', null),
  ]);

  const offset = Number(Deno.env.get('REPORT_UTC_OFFSET') ?? '5');
  const clock = makeClock(offset);

  const goal = Math.max(0, Number(Deno.env.get('TELEGRAM_DAILY_GOAL') ?? '60000000') || 0);
  const closesAt = Math.min(24, Math.max(1, Number(Deno.env.get('TELEGRAM_DAY_CLOSES_AT') ?? '24') || 24));
  const lowStockPct = Math.max(0, Number(Deno.env.get('TELEGRAM_LOW_STOCK_PCT') ?? '20') || 0);

  const nowMs = Date.now();
  const todayIndex = clock.dayOf(nowMs);
  const nowLocal = clock.local(nowMs);
  const nowMinute = clock.minuteOf(nowMs);

  // --- fold the sales into the shapes the report needs -----------------------

  const parsed: Sale[] = [];
  for (const row of salesRes.data ?? []) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const boxes = Number(p.boxesBought ?? p.boxes) || 0;
    const total = boxes * (Number(p.pricePerBox) || 0);
    const iso = typeof p.createdAt === 'string' ? p.createdAt : row.updated_at;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    parsed.push({
      day: clock.dayOf(ms),
      minute: clock.minuteOf(ms),
      total,
      fruit: String(p.fruit ?? '').trim(),
    });
  }

  const byDay = new Map<number, { total: number; count: number; firstMinute: number }>();
  for (const sale of parsed) {
    const held = byDay.get(sale.day);
    if (held) {
      held.total += sale.total;
      held.count++;
      if (sale.minute < held.firstMinute) held.firstMinute = sale.minute;
    } else {
      byDay.set(sale.day, { total: sale.total, count: 1, firstMinute: sale.minute });
    }
  }

  const dayTotal = (index: number) => byDay.get(index)?.total ?? 0;
  const dayCount = (index: number) => byDay.get(index)?.count ?? 0;

  const todayTotal = dayTotal(todayIndex);
  const todayCount = dayCount(todayIndex);
  const yesterdayTotal = dayTotal(todayIndex - 1);
  const yesterdayCount = dayCount(todayIndex - 1);

  // --- the week: Monday through Sunday containing today ----------------------

  // getUTCDay on the shifted date is the local weekday. Sunday is 0; the week
  // starts on Monday here, which is what the labels below assume.
  const weekday = nowLocal.getUTCDay();
  const mondayIndex = todayIndex - ((weekday + 6) % 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => ({
    index: mondayIndex + i,
    label: t.days[(1 + i) % 7]!,
    total: dayTotal(mondayIndex + i),
    isToday: mondayIndex + i === todayIndex,
    isFuture: mondayIndex + i > todayIndex,
  }));

  const weekTotal = weekDays.reduce((sum, d) => sum + d.total, 0);
  const weekPeak = Math.max(...weekDays.map((d) => d.total), 0);
  const bestDay = weekDays.reduce((best, d) => (d.total > best.total ? d : best), weekDays[0]!);

  const lastWeekTotal = Array.from({ length: 7 }, (_, i) => dayTotal(mondayIndex - 7 + i)).reduce(
    (sum, n) => sum + n,
    0
  );
  const weekChange =
    lastWeekTotal > 0 ? Math.round(((weekTotal - lastWeekTotal) / lastWeekTotal) * 100) : null;

  // The average is over days that have actually happened, so a Monday morning
  // is not divided by seven and reported as a collapse.
  const elapsed = weekDays.filter((d) => !d.isFuture).length || 1;
  const weekAverage = weekTotal / elapsed;

  // --- record, streak --------------------------------------------------------

  let recordDay = { index: 0, total: 0 };
  for (const [index, day] of byDay) {
    if (day.total > recordDay.total) recordDay = { index, total: day.total };
  }

  // Counted back from yesterday when today is still empty: a day that has not
  // finished yet has not broken anything.
  let streak = 0;
  let cursor = todayTotal > 0 ? todayIndex : todayIndex - 1;
  while (dayTotal(cursor) > 0) {
    streak++;
    cursor--;
  }
  const streakAtRisk = streak > 0 && todayTotal === 0;

  // --- top goods this week ---------------------------------------------------

  const goods = new Map<string, { count: number; total: number }>();
  for (const sale of parsed) {
    if (sale.day < mondayIndex || sale.day > todayIndex) continue;
    const name = sale.fruit || '—';
    const held = goods.get(name);
    if (held) {
      held.count++;
      held.total += sale.total;
    } else {
      goods.set(name, { count: 1, total: sale.total });
    }
  }
  const topGoods = [...goods.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 3);

  // --- stock -----------------------------------------------------------------

  let stockValue = 0;
  let runningOut = 0;
  for (const row of trucksRes.data ?? []) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const boxes = Number(p.boxes) || 0;
    const sold = Number(p.boxesSold) || 0;
    const remaining = Math.max(0, boxes - sold);
    stockValue += remaining * (Number(p.pricePerBox) || 0);
    if (boxes > 0 && remaining > 0 && (remaining / boxes) * 100 <= lowStockPct) runningOut++;
  }

  // --- the goal --------------------------------------------------------------

  const goalLeft = Math.max(0, goal - todayTotal);
  const goalFraction = goal > 0 ? todayTotal / goal : 0;
  const minutesLeft = Math.max(0, closesAt * 60 - nowMinute);
  const perHour = minutesLeft > 0 ? goalLeft / (minutesLeft / 60) : 0;

  // --- build it --------------------------------------------------------------

  const rule = '━━━━━━━━━━━━━━━━━━';
  const date = `${t.days[weekday]}, ${nowLocal.getUTCDate()} ${t.months[nowLocal.getUTCMonth()]}`;

  const rows: string[] = [
    `🏆 <b>${t.title}</b>`,
    `📅 ${date} · ${hhmm(nowMinute)}`,
    rule,
    '',
    `💰 <b>${t.today}</b>`,
    `   ${money(todayTotal)} ${t.soum} · ${todayCount} ${t.sales}`,
    `   ${meter(goalFraction)}  ${Math.round(goalFraction * 100)}%`,
    '',
    `🎯 <b>${t.goal}</b> · ${money(goal)} ${t.soum}`,
  ];

  if (goalLeft === 0) {
    rows.push(`   🎉 ${t.goalDone}`);
  } else {
    rows.push(`   ${t.left}: ${money(goalLeft)} ${t.soum}`);
    if (minutesLeft > 0) {
      const h = Math.floor(minutesLeft / 60);
      const m = minutesLeft % 60;
      rows.push(`   ⏳ ${h}${t.hourShort} ${m}${t.minShort} ${t.untilClose}`);
      rows.push(`   💡 ${fill(t.needPerHour, { n: money(perHour) })}`);
    } else {
      rows.push(`   ⏳ ${t.closed}`);
    }
  }

  rows.push(
    '',
    `📈 <b>${t.compare}</b>`,
    leader(t.yesterday, `${money(yesterdayTotal)}  (${yesterdayCount} ${t.sales})`),
    leader(t.weekAvg, money(weekAverage)),
  );

  if (recordDay.total > 0) {
    const recordDate = clock.local(recordDay.index * DAY_MS);
    rows.push(
      leader(
        t.record,
        `${money(recordDay.total)}  🥇 (${recordDate.getUTCDate()} ${t.months[recordDate.getUTCMonth()]})`
      )
    );
  }

  rows.push('', `📊 <b>${t.week}</b>`);
  for (const day of weekDays) {
    const flag = day.isToday ? ` ${t.now}` : day.total > 0 && day === bestDay ? ' 🔥' : '';
    rows.push(`   ${day.label} ${bar(day.total, weekPeak)}  ${millions(day.total)} ${t.mln}${flag}`);
  }
  rows.push('   ─────────────────────');
  rows.push(
    `   ${t.weekTotal}: ${millions(weekTotal)} ${t.mln}` +
      (weekChange === null
        ? ''
        : ` · ${weekChange >= 0 ? '📈 +' : '📉 '}${weekChange}% ${t.vsLastWeek}`)
  );

  rows.push('', `🔥 <b>${t.streak}</b>: ${streak > 0 ? fill(t.streakDays, { n: streak }) : t.streakNone}`);
  if (streakAtRisk) rows.push(`   ⚠️ ${t.streakRisk}`);

  rows.push('', `🏅 <b>${t.topGoods}</b>`);
  if (topGoods.length === 0) {
    rows.push(`   ${t.noGoods}`);
  } else {
    topGoods.forEach(([name, stat], i) => {
      rows.push(
        `   ${i + 1}. ${esc(name)} ... ${stat.count} ${t.sales} · ${millions(stat.total)} ${t.mln}`
      );
    });
  }

  rows.push('', `📦 <b>${t.stock}</b>`, `   ${t.stockLeft}: ${money(stockValue)} ${t.soum}`);
  if (runningOut > 0) rows.push(`   ⚠️ ${fill(t.runningOut, { n: runningOut })}`);

  // The closing line reads the day rather than repeating it — the one place the
  // report is allowed to have an opinion.
  const yesterdayFirst = byDay.get(todayIndex - 1)?.firstMinute;
  let closing: string;
  if (todayTotal === 0 && yesterdayFirst !== undefined && yesterdayFirst > nowMinute) {
    closing = fill(t.firstSaleWas, { time: hhmm(yesterdayFirst) });
  } else if (todayTotal === 0) {
    closing = t.quietDay;
  } else if (todayTotal >= yesterdayTotal) {
    closing = t.goingWell;
  } else {
    closing = t.behind;
  }

  rows.push('', rule, `💬 ${closing}`);

  const text = rows.join('\n');

  const call = (method: string, payload: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  let delivered = 0;
  let pinned = 0;
  const problems: string[] = [];

  for (const group of groups) {
    const chatId = group.telegram_chat_id!;
    try {
      const res = await call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      const sent = await res.json().catch(() => null);

      if (!sent?.ok) {
        const description = String(sent?.description ?? `HTTP ${res.status}`);
        console.error('report failed', group.id, description);
        problems.push(description);
        continue;
      }

      delivered++;
      const messageId: number | null =
        typeof sent.result?.message_id === 'number' ? sent.result.message_id : null;
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
        await admin.from('telegram_posts').upsert(
          {
            kind: 'report',
            doc_id: String(chatId),
            message_id: messageId,
            posted_at: new Date().toISOString(),
          },
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
