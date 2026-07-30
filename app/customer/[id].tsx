import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Badge, Card } from '@/components/Card';
import { Confirm } from '@/components/Confirm';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import {
  createPayment,
  customerName,
  listConsents,
  listPayments,
  listSales,
  raiseWarning,
  setWarningResult,
  tokensFor,
} from '@/lib/api';
import type { ConsentRow, WarnResult } from '@/lib/database.types';
import { blankIfZero, formatDate, num, parseAmount } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { haptics } from '@/lib/haptics';
import { sendPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { isWalkIn, saleTotal, type SaleDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Detail {
  name: string;
  consent: ConsentRow | null;
  sales: SaleDoc[];
  paidBySale: Map<string, number>;
}

async function loadDetail(customerId: string): Promise<Detail> {
  const [name, consents, sales, payments] = await Promise.all([
    customerName(customerId),
    listConsents(),
    listSales(),
    listPayments(),
  ]);

  const paidBySale = new Map<string, number>();
  for (const p of payments) {
    paidBySale.set(p.saleId, (paidBySale.get(p.saleId) ?? 0) + p.amount);
  }

  return {
    name,
    consent: consents.find((c) => c.user_id === customerId) ?? null,
    sales: sales.filter((s) => s.customerId === customerId),
    paidBySale,
  };
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = typeof id === 'string' ? id : '';
  const { t, lang, accentColors } = usePrefs();
  const theme = useTheme();
  const { profile } = useAuth();
  const router = useRouter();

  const { data, loading, reload } = useLoader(
    useCallback(() => loadDetail(customerId), [customerId])
  );

  const [warnState, setWarnState] = useState<WarnResult | null>(null);
  const [warningId, setWarningId] = useState<string | null>(null);
  const [askWarn, setAskWarn] = useState(false);
  const [warning, setWarning] = useState(false);
  const [warnFailed, setWarnFailed] = useState(false);
  const [paySale, setPaySale] = useState<SaleDoc | null>(null);
  const [payAmount, setPayAmount] = useState('');

  // Watch the raised warning so the owner sees the customer's answer land.
  useEffect(() => {
    if (!warningId) return;
    const channel = supabase
      .channel(`warning:${warningId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'warnings', filter: `id=eq.${warningId}` },
        (payload) => {
          const next = payload.new as { result: WarnResult };
          setWarnState(next.result);
          if (next.result === 'located') haptics.saved();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [warningId]);

  const sendWarning = async () => {
    if (!profile || !customerId || !data) return;

    setWarning(true);
    setWarnFailed(false);
    try {
      const consent = data.consent;
      const allowed = Boolean(consent?.location_granted && !consent.revoked_at);

      const raised = await raiseWarning(customerId, profile.id);
      setWarningId(raised.id);
      setWarnState('pending');
      haptics.heavy();

      // The push always goes out; only the location request is gated on consent.
      const tokens = await tokensFor(customerId);
      const delivered = await sendPush(
        tokens,
        t('warnPushTitle', { name: profile.full_name }),
        t('warnPushBody'),
        { warningId: raised.id }
      );

      if (!allowed) {
        // Consent refused or revoked: recorded as such, never silently tracked.
        await setWarningResult(raised.id, 'denied');
        setWarnState('denied');
        return;
      }

      if (!delivered && tokens.length === 0) {
        // Nothing to push to. Recorded as such so the owner knows the customer
        // was not buzzed — their device still answers over realtime if the app
        // happens to be open, which updates this row again.
        await setWarningResult(raised.id, 'no_device');
        setWarnState('no_device');
      }
    } catch {
      // Raising the warning is the part that can fail outright — offline, or
      // RLS refusing the insert. Without this the button looked dead.
      haptics.failed();
      setWarnState(null);
      setWarnFailed(true);
    } finally {
      setWarning(false);
      setAskWarn(false);
    }
  };

  const confirmWarn = () => {
    if (!data) return;
    haptics.warn();
    setWarnFailed(false);
    setAskWarn(true);
  };

  const submitPayment = async () => {
    const amount = parseAmount(payAmount);
    if (!paySale || amount === null) return;
    await createPayment(paySale.id, amount);
    haptics.saved();
    setPaySale(null);
    setPayAmount('');
    await reload();
  };

  // No account means no device: nothing to push a warning to, and no location
  // to ask for. The whole WARN flow is meaningless for a walk-in.
  const walkIn = isWalkIn(customerId);

  const sales = data?.sales ?? [];
  const outstanding = sales.reduce(
    (sum, s) => sum + Math.max(0, saleTotal(s) - (data?.paidBySale.get(s.id) ?? 0)),
    0
  );
  const owed = blankIfZero(outstanding);

  const warnLabel: Record<WarnResult, string> = {
    pending: t('resultPending'),
    located: t('resultLocated'),
    denied: t('resultDenied'),
    unavailable: t('resultUnavailable'),
    no_device: t('resultNoDevice'),
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Header
        title={data?.name || t('loading')}
        subtitle={
          [owed ? `${t('owes')} ${owed} ${t('soum')}` : t('settled'), walkIn ? t('walkInBadge') : null]
            .filter(Boolean)
            .join(' · ')
        }
        onBack={() => router.back()}
        onTitlePress={() => router.push(`/edit-customer?id=${customerId}`)}
        actionIcon="add"
        actionLabel={t('addSale')}
        onAction={() => router.push(`/new-sale?customerId=${customerId}`)}
      />

      {warnFailed ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={[styles.warnBanner, { backgroundColor: theme.dangerSoft }]}
        >
          <Ionicons name="alert-circle" size={18} color={theme.danger} />
          <Text variant="label" color={theme.danger} style={styles.warnText}>
            {t('warnFailed')}
          </Text>
          <PressableScale onPress={() => setWarnFailed(false)} to={0.94} haptic="tap">
            <Ionicons name="close" size={16} color={theme.danger} />
          </PressableScale>
        </Animated.View>
      ) : null}

      {warnState ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={[
            styles.warnBanner,
            {
              backgroundColor: warnState === 'located' ? accentColors.soft : theme.dangerSoft,
            },
          ]}
        >
          <Ionicons
            name={warnState === 'located' ? 'location' : 'alert-circle'}
            size={18}
            color={warnState === 'located' ? accentColors.base : theme.danger}
          />
          <Text
            variant="label"
            color={warnState === 'located' ? accentColors.base : theme.danger}
            style={styles.warnText}
          >
            {warnLabel[warnState]}
          </Text>
          {warnState === 'located' ? (
            <PressableScale onPress={() => router.navigate('/(owner)/map')} to={0.94} haptic="tap">
              <Text variant="label" color={accentColors.base}>
                {t('viewOnMap')}
              </Text>
            </PressableScale>
          ) : null}
        </Animated.View>
      ) : null}

      <FlatList
        data={sales}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={loading && sales.length > 0}
        onRefresh={() => void reload()}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState icon="receipt-outline" title={t('noSales')} hint={t('noSalesHint')} />
          )
        }
        renderItem={({ item, index }) => {
          const total = saleTotal(item);
          const paid = data?.paidBySale.get(item.id) ?? 0;
          const remaining = Math.max(0, total - paid);
          const settled = remaining === 0;

          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}>
              <Card>
                {/* Requirement 7: the owner who created the sale, at the top. */}
                <View style={styles.author}>
                  <Ionicons name="person-circle-outline" size={16} color={theme.textFaint} />
                  <Text variant="caption" color={theme.textFaint}>
                    {item.createdByName
                      ? t('addedBy', { name: item.createdByName })
                      : t('unassigned')}
                  </Text>
                  <View style={styles.spacer} />
                  <Text variant="caption" color={theme.textFaint}>
                    {formatDate(item.createdAt, lang)}
                  </Text>
                </View>

                <View style={styles.saleRow}>
                  <Text variant="heading">{displayFruit(item.fruit, t) || t('none')}</Text>
                  <Badge
                    label={settled ? t('settled') : t('owes')}
                    color={settled ? theme.success : theme.warning}
                    soft={settled ? 'rgba(18,183,106,0.14)' : 'rgba(247,144,9,0.14)'}
                  />
                </View>

                <Text variant="label" color={theme.textDim} numeric style={styles.breakdown}>
                  {num(item.boxes)} × {num(item.pricePerBox)} {t('soum')}
                </Text>

                <View style={styles.money}>
                  <Money label={t('total')} value={total} />
                  <Money label={t('paid')} value={paid} />
                  <Money
                    label={t('remaining')}
                    value={remaining}
                    color={settled ? theme.textFaint : theme.warning}
                  />
                </View>

                {!settled ? (
                  <Button
                    label={t('recordPayment')}
                    variant="secondary"
                    onPress={() => {
                      setPaySale(item);
                      setPayAmount('');
                    }}
                    style={styles.payButton}
                  />
                ) : null}
              </Card>
            </Animated.View>
          );
        }}
      />

      {walkIn ? null : (
        <View style={styles.footer}>
          <Button
            label={t('warn')}
            variant="danger"
            haptic="heavy"
            onPress={confirmWarn}
            disabled={!data}
            loading={warning}
            icon={<Ionicons name="warning" size={20} color="#FFF5F4" />}
          />
        </View>
      )}

      <Confirm
        visible={askWarn}
        title={t('warnTitle')}
        message={t('warnBody', { name: data?.name ?? '' })}
        confirmLabel={t('warnSend')}
        cancelLabel={t('cancel')}
        destructive
        busy={warning}
        onConfirm={() => void sendWarning()}
        onCancel={() => setAskWarn(false)}
      />

      <Sheet
        visible={paySale !== null}
        title={t('recordPayment')}
        onClose={() => setPaySale(null)}
      >
        <Field
          label={t('paymentAmount')}
          value={payAmount}
          onChangeText={setPayAmount}
          placeholder={t('paymentAmount')}
          keyboardType="number-pad"
          suffix={t('soum')}
          autoFocus
        />
        <Button
          label={t('save')}
          onPress={() => void submitPayment()}
          disabled={parseAmount(payAmount) === null}
        />
      </Sheet>
    </Screen>
  );
}

function Money({ label, value, color }: { label: string; value: number; color?: string }) {
  const theme = useTheme();
  const shown = blankIfZero(value);
  return (
    <View style={styles.moneyCell}>
      <Text variant="caption" color={theme.textFaint}>
        {label}
      </Text>
      <Text variant="label" numeric color={color ?? theme.text}>
        {shown ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.xl },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  spacer: { flex: 1 },
  saleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  breakdown: { marginTop: space.xs },
  money: { flexDirection: 'row', gap: space.lg, marginTop: space.base },
  moneyCell: { gap: 2 },
  payButton: { marginTop: space.base },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginBottom: space.md,
  },
  warnText: { flex: 1 },
  footer: { paddingTop: space.md },
});
