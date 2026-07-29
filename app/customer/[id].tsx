import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Badge, Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import {
  createPayment,
  listConsents,
  listPayments,
  listProfiles,
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
import { saleTotal, type SaleDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

interface Detail {
  name: string;
  consent: ConsentRow | null;
  sales: SaleDoc[];
  paidBySale: Map<string, number>;
}

async function loadDetail(customerId: string): Promise<Detail> {
  const [profiles, consents, sales, payments] = await Promise.all([
    listProfiles(),
    listConsents(),
    listSales(),
    listPayments(),
  ]);

  const paidBySale = new Map<string, number>();
  for (const p of payments) {
    paidBySale.set(p.saleId, (paidBySale.get(p.saleId) ?? 0) + p.amount);
  }

  return {
    name: profiles.find((p) => p.id === customerId)?.full_name ?? '',
    consent: consents.find((c) => c.user_id === customerId) ?? null,
    sales: sales.filter((s) => s.customerId === customerId),
    paidBySale,
  };
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = typeof id === 'string' ? id : '';
  const { t, lang, accentColors } = usePrefs();
  const { profile } = useAuth();
  const router = useRouter();

  const { data, loading, reload } = useLoader(
    useCallback(() => loadDetail(customerId), [customerId])
  );

  const [warnState, setWarnState] = useState<WarnResult | null>(null);
  const [warningId, setWarningId] = useState<string | null>(null);
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

    const consent = data.consent;
    const allowed = Boolean(consent?.location_granted && !consent.revoked_at);

    const warning = await raiseWarning(customerId, profile.id);
    setWarningId(warning.id);
    setWarnState('pending');
    haptics.heavy();

    // The push always goes out; only the location request is gated on consent.
    const tokens = await tokensFor(customerId);
    const delivered = await sendPush(
      tokens,
      t('warnPushTitle', { name: profile.full_name }),
      t('warnPushBody'),
      { warningId: warning.id }
    );

    if (!allowed) {
      // Consent refused or revoked: recorded as such, never silently tracked.
      await setWarningResult(warning.id, 'denied');
      setWarnState('denied');
      return;
    }

    if (!delivered && tokens.length === 0) {
      await setWarningResult(warning.id, 'no_device');
      setWarnState('no_device');
    }
  };

  const confirmWarn = () => {
    if (!data) return;
    haptics.warn();
    Alert.alert(t('warnTitle'), t('warnBody', { name: data.name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('warnSend'), style: 'destructive', onPress: () => void sendWarning() },
    ]);
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
        subtitle={owed ? `${t('owes')} ${owed} ${t('soum')}` : t('settled')}
        onBack={() => router.back()}
        onTitlePress={() => router.push(`/edit-customer?id=${customerId}`)}
        actionIcon="add"
        actionLabel={t('addSale')}
        onAction={() => router.push(`/new-sale?customerId=${customerId}`)}
      />

      {warnState ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          style={[
            styles.warnBanner,
            {
              backgroundColor: warnState === 'located' ? accentColors.soft : palette.dangerSoft,
            },
          ]}
        >
          <Ionicons
            name={warnState === 'located' ? 'location' : 'alert-circle'}
            size={18}
            color={warnState === 'located' ? accentColors.base : palette.danger}
          />
          <Text
            variant="label"
            color={warnState === 'located' ? accentColors.base : palette.danger}
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
                  <Ionicons name="person-circle-outline" size={16} color={palette.textFaint} />
                  <Text variant="caption" color={palette.textFaint}>
                    {item.createdByName
                      ? t('addedBy', { name: item.createdByName })
                      : t('unassigned')}
                  </Text>
                  <View style={styles.spacer} />
                  <Text variant="caption" color={palette.textFaint}>
                    {formatDate(item.createdAt, lang)}
                  </Text>
                </View>

                <View style={styles.saleRow}>
                  <Text variant="heading">{displayFruit(item.fruit, t) || t('none')}</Text>
                  <Badge
                    label={settled ? t('settled') : t('owes')}
                    color={settled ? palette.success : palette.warning}
                    soft={settled ? 'rgba(18,183,106,0.14)' : 'rgba(247,144,9,0.14)'}
                  />
                </View>

                <Text variant="label" color={palette.textDim} numeric style={styles.breakdown}>
                  {num(item.boxes)} × {num(item.pricePerBox)} {t('soum')}
                </Text>

                <View style={styles.money}>
                  <Money label={t('total')} value={total} />
                  <Money label={t('paid')} value={paid} />
                  <Money
                    label={t('remaining')}
                    value={remaining}
                    color={settled ? palette.textFaint : palette.warning}
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

      <View style={styles.footer}>
        <Button
          label={t('warn')}
          variant="danger"
          haptic="heavy"
          onPress={confirmWarn}
          icon={<Ionicons name="warning" size={20} color="#FFF5F4" />}
        />
      </View>

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
  const shown = blankIfZero(value);
  return (
    <View style={styles.moneyCell}>
      <Text variant="caption" color={palette.textFaint}>
        {label}
      </Text>
      <Text variant="label" numeric color={color ?? palette.text}>
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
