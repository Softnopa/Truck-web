import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Avatar, Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { listConsents, listPayments, listProfiles, listSales } from '@/lib/api';
import { blankIfZero, formatDate, initials } from '@/lib/format';
import { saleTotal } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface CustomerSummary {
  id: string;
  name: string;
  outstanding: number;
  sharesLocation: boolean;
  lastSaleAt: string | null;
}

async function loadCustomers(): Promise<CustomerSummary[]> {
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

  const owed = new Map<string, number>();
  const lastSale = new Map<string, string>();
  for (const sale of sales) {
    if (!sale.customerId) continue;
    const due = saleTotal(sale) - (paidBySale.get(sale.id) ?? 0);
    owed.set(sale.customerId, (owed.get(sale.customerId) ?? 0) + Math.max(0, due));

    const seen = lastSale.get(sale.customerId);
    if (!seen || sale.createdAt > seen) lastSale.set(sale.customerId, sale.createdAt);
  }

  const consentByUser = new Map(consents.map((c) => [c.user_id, c]));

  return profiles
    .filter((p) => p.role === 'customer')
    .map((p) => {
      const consent = consentByUser.get(p.id);
      return {
        id: p.id,
        name: p.full_name,
        outstanding: owed.get(p.id) ?? 0,
        sharesLocation: Boolean(consent?.location_granted && !consent.revoked_at),
        lastSaleAt: lastSale.get(p.id) ?? null,
      };
    });
}

type Filter = 'all' | 'debt';

export default function Customers() {
  const { t, lang, accentColors } = usePrefs();
  const theme = useTheme();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(loadCustomers, []));
  const [filter, setFilter] = useState<Filter>('all');

  // Another owner recording a payment changes who owes what, so this list has
  // to follow their writes, not just this device's.
  useRealtime('customers', ['sales', 'payments', 'profiles', 'consents'], reload);

  const all = useMemo(() => data ?? [], [data]);
  const debtors = useMemo(
    () => all.filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding),
    [all]
  );

  const shown = filter === 'debt' ? debtors : all;
  const totalDebt = debtors.reduce((sum, c) => sum + c.outstanding, 0);
  const debtLabel = blankIfZero(totalDebt);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header title={t('customers')} />

      <View style={styles.controls}>
        <Segmented
          options={[
            { value: 'all' as Filter, label: t('allCustomers') },
            {
              value: 'debt' as Filter,
              label: debtors.length > 0 ? `${t('astatka')} · ${debtors.length}` : t('astatka'),
            },
          ]}
          value={filter}
          onChange={setFilter}
        />

        {/* The number the owners actually care about, given the weight to match.
            Tapping it jumps straight to the people who owe it. */}
        {debtLabel ? (
          <Animated.View layout={LinearTransition} entering={FadeInDown.duration(320)}>
            <PressableScale
              onPress={() => setFilter(filter === 'debt' ? 'all' : 'debt')}
              to={0.985}
              accessibilityLabel={`${t('totalDebt')} ${debtLabel} ${t('soum')}`}
            >
              <View
                style={[
                  styles.debtCard,
                  {
                    backgroundColor: theme.dangerSoft,
                    borderColor: theme.warning + '33',
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <View style={styles.debtTop}>
                  <View style={[styles.debtIcon, { backgroundColor: theme.warning + '1F' }]}>
                    <Ionicons name="wallet" size={16} color={theme.warning} />
                  </View>
                  <Text variant="caption" color={theme.textDim} style={styles.debtEyebrow}>
                    {t('totalDebt').toUpperCase()}
                  </Text>
                  <Ionicons
                    name={filter === 'debt' ? 'chevron-up' : 'chevron-forward'}
                    size={16}
                    color={theme.textFaint}
                  />
                </View>

                {/* Amount and unit on one baseline: the figure is the headline,
                    the currency is a footnote to it. */}
                <View style={styles.debtAmount}>
                  <Text variant="display" numeric color={theme.warning}>
                    {debtLabel}
                  </Text>
                  <Text variant="heading" color={theme.warning} style={styles.debtUnit}>
                    {t('soum')}
                  </Text>
                </View>

                <Text variant="label" color={theme.textDim}>
                  {t('owesCount', { n: debtors.length })}
                </Text>
              </View>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={loading && all.length > 0}
        onRefresh={() => void reload()}
        ListEmptyComponent={
          loading ? null : filter === 'debt' ? (
            <EmptyState icon="happy-outline" title={t('noDebtors')} hint={t('noDebtorsHint')} />
          ) : (
            <EmptyState icon="people-outline" title={t('noCustomers')} hint={t('noCustomersHint')} />
          )
        }
        renderItem={({ item, index }) => {
          const owedText = blankIfZero(item.outstanding);
          return (
            <Animated.View
              layout={LinearTransition.springify().damping(20)}
              entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}
            >
              <PressableScale
                onPress={() => router.push(`/customer/${item.id}`)}
                to={0.985}
                accessibilityLabel={item.name}
              >
                <Card>
                  <View style={styles.row}>
                    <Avatar text={initials(item.name)} color={accentColors.base} />
                    <View style={styles.identity}>
                      <Text variant="heading" numberOfLines={1}>
                        {item.name || t('none')}
                      </Text>
                      {owedText ? (
                        <Text variant="label" color={theme.warning} numeric>
                          {t('owes')} {owedText} {t('soum')}
                        </Text>
                      ) : (
                        <Text variant="label" color={theme.textFaint}>
                          {t('settled')}
                        </Text>
                      )}
                      {item.lastSaleAt ? (
                        <Text variant="caption" color={theme.textFaint}>
                          {t('lastSale')}: {formatDate(item.lastSaleAt, lang)}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={item.sharesLocation ? 'location' : 'location-outline'}
                      size={18}
                      color={item.sharesLocation ? accentColors.base : theme.textFaint}
                    />
                    <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
                  </View>
                </Card>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: { gap: space.md, paddingBottom: space.base },
  debtCard: {
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.base,
    gap: space.xs,
  },
  debtTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  debtIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtEyebrow: { flex: 1, letterSpacing: 1.2 },
  debtAmount: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  debtUnit: { opacity: 0.8 },
  list: { gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { flex: 1, gap: 2 },
});
