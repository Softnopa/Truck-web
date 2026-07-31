import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Header } from '@/components/Header';
import { RainbowButton } from '@/components/RainbowButton';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import type { StringKey } from '@/i18n/strings';
import { EdgeFunctionError, listPayments, listSales, postGrowthReport } from '@/lib/api';
import { blankIfZero } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { loadReportLang, saveReportLang, type ReportLang } from '@/lib/reportLang';
import { saleTotal } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Summary {
  today: number;
  yesterday: number;
  count: number;
  change: number | null;
}

/**
 * The day, cut at the phone's own midnight.
 *
 * The report itself is built server-side and cuts the day at `REPORT_UTC_OFFSET`
 * — UTC+5, Tashkent. These two agree for anyone standing in Uzbekistan, which
 * is everyone this is for; a phone carried to another timezone would read a
 * few hours differently here than the group post does, and the group post is
 * the one that counts.
 */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

async function loadSummary(): Promise<Summary> {
  const [sales] = await Promise.all([listSales(), listPayments()]);

  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - 86_400_000));

  let today = 0;
  let yesterday = 0;
  let count = 0;

  for (const sale of sales) {
    const key = dayKey(new Date(sale.createdAt));
    if (key === todayKey) {
      today += saleTotal(sale);
      count++;
    } else if (key === yesterdayKey) {
      yesterday += saleTotal(sale);
    }
  }

  const change = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;
  return { today, yesterday, count, change };
}

/** What went wrong, in the owner's language rather than the server's. */
function failureKey(error: unknown): StringKey {
  if (!(error instanceof EdgeFunctionError)) return 'somethingWrong';
  switch (error.code) {
    case 'not_linked':
      return 'growthNoGroup';
    case 'not_configured':
      return 'growthNotConfigured';
    case 'unreachable':
      return 'growthUnreachable';
    case 'unauthorized':
    case 'forbidden':
      return 'growthForbidden';
    case 'telegram_failed':
      return 'growthTelegramFailed';
    default:
      return 'growthFailed';
  }
}

type Notice = { kind: 'ok' | 'warn' | 'bad'; text: string };

/**
 * One button, and the numbers it is about to send.
 *
 * The figures above the button are not decoration: pressing this publishes the
 * day's takings to every group at once, and an owner should be able to see what
 * that says before it says it.
 */
export default function Growth() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();

  const { data, reload } = useLoader(useCallback(loadSummary, []));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // What the *group* reads, which is not the same question as what this owner
  // reads — see lib/reportLang.ts.
  const [reportLang, setReportLang] = useState<ReportLang>('ru');
  useEffect(() => {
    let alive = true;
    void loadReportLang().then((saved) => {
      if (alive) setReportLang(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const pickLang = (next: ReportLang) => {
    setReportLang(next);
    void saveReportLang(next);
  };

  useRealtime('growth', ['sales', 'payments'], reload);

  const summary = useMemo<Summary>(
    () => data ?? { today: 0, yesterday: 0, count: 0, change: null },
    [data]
  );

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await postGrowthReport(reportLang);
      haptics.saved();
      setNotice(
        result.pinned > 0
          ? { kind: 'ok', text: t('growthPinned', { n: result.pinned }) }
          : // Delivered but not pinned is the common half-success: the bot is a
            // member of the group rather than an admin. Naming it beats a tick.
            { kind: 'warn', text: t('growthNotPinned') }
      );
    } catch (error) {
      haptics.failed();
      setNotice({ kind: 'bad', text: t(failureKey(error)) });
      if (error instanceof EdgeFunctionError) {
        console.warn('growth-telegram failed', error.code, error.status, error.detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const up = summary.change !== null && summary.change > 0;
  const down = summary.change !== null && summary.change < 0;
  const trendColor = up ? theme.success : down ? theme.danger : theme.textDim;

  const noticeColor =
    notice?.kind === 'ok' ? accentColors.base : notice?.kind === 'warn' ? theme.warning : theme.danger;
  const noticeBg =
    notice?.kind === 'ok' ? accentColors.soft : notice?.kind === 'warn' ? 'rgba(247,144,9,0.14)' : theme.dangerSoft;

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header title={t('growth')} />

      <Animated.View entering={FadeInDown.duration(320)} style={styles.stats}>
        <View style={styles.figure}>
          <Text variant="caption" color={theme.textFaint} style={styles.eyebrow}>
            {t('growthToday').toUpperCase()}
          </Text>
          <View style={styles.amount}>
            <Text variant="display" numeric>
              {blankIfZero(summary.today) ?? '0'}
            </Text>
            <Text variant="heading" color={theme.textDim} style={styles.unit}>
              {t('soum')}
            </Text>
          </View>
        </View>

        <View style={styles.against}>
          {summary.change !== null ? (
            <View style={styles.trend}>
              <Ionicons
                name={up ? 'trending-up' : down ? 'trending-down' : 'remove'}
                size={16}
                color={trendColor}
              />
              <Text variant="label" color={trendColor} numeric>
                {Math.abs(summary.change)}%
              </Text>
            </View>
          ) : null}
          <Text variant="caption" color={theme.textFaint}>
            {t('growthSalesToday', { n: summary.count })}
          </Text>
        </View>
      </Animated.View>

      {notice ? (
        <Animated.View entering={FadeIn.duration(220)}>
          <PressableScale onPress={() => setNotice(null)} to={0.99} accessibilityLabel={notice.text}>
            <View style={[styles.notice, { backgroundColor: noticeBg }]}>
              <Ionicons
                name={notice.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={noticeColor}
              />
              <Text variant="label" color={noticeColor} style={styles.noticeText}>
                {notice.text}
              </Text>
              <Ionicons name="close" size={14} color={noticeColor} />
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* Above the button, never inside it: the language is a decision about
          the post, and it should be settled before the press rather than
          discovered after one has gone out in the wrong one. */}
      <View style={styles.langRow}>
        <Text variant="caption" color={theme.textFaint} style={styles.eyebrow}>
          {t('reportLanguage').toUpperCase()}
        </Text>
        <View style={styles.langPicker}>
          <Segmented
            options={[
              { value: 'ru' as ReportLang, label: 'Русский' },
              { value: 'uz' as ReportLang, label: "O'zbekcha" },
            ]}
            value={reportLang}
            onChange={pickLang}
          />
        </View>
      </View>

      <View style={styles.stage}>
        <RainbowButton
          label={t('growthAction')}
          hint={t('growthHint')}
          busy={busy}
          onPress={() => void send()}
          icon={<Ionicons name="rocket" size={54} color={accentColors.base} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: space.base, paddingBottom: space.base },
  figure: { flex: 1, gap: space.xs },
  eyebrow: { letterSpacing: 1.2 },
  amount: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  unit: { opacity: 0.8 },
  against: { alignItems: 'flex-end', gap: space.xs },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.sm,
    marginBottom: space.md,
  },
  noticeText: { flex: 1 },
  langRow: { gap: space.sm, paddingBottom: space.md },
  langPicker: { alignSelf: 'stretch' },
  /** Everything left after the header and the figures — about 70% of the page. */
  stage: { flex: 1, paddingBottom: space.base },
});
