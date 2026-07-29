import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Badge, Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { listPayments, listSales } from '@/lib/api';
import { blankIfZero, formatDate, num } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { saleTotal } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, space } from '@/theme/tokens';

/** RLS returns only this customer's own sales, so no client-side filter is needed. */
async function loadMine() {
  const [sales, payments] = await Promise.all([listSales(), listPayments()]);
  const paidBySale = new Map<string, number>();
  for (const p of payments) {
    paidBySale.set(p.saleId, (paidBySale.get(p.saleId) ?? 0) + p.amount);
  }
  return { sales, paidBySale };
}

export default function MyPurchases() {
  const { t, lang } = usePrefs();
  const { data, loading, reload } = useLoader(useCallback(loadMine, []));

  const sales = data?.sales ?? [];
  const outstanding = sales.reduce(
    (sum, s) => sum + Math.max(0, saleTotal(s) - (data?.paidBySale.get(s.id) ?? 0)),
    0
  );
  const owed = blankIfZero(outstanding);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header
        title={t('tabPurchases')}
        subtitle={owed ? `${t('owes')} ${owed} ${t('soum')}` : t('settled')}
      />

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
                <View style={styles.author}>
                  <Ionicons name="person-circle-outline" size={16} color={palette.textFaint} />
                  <Text variant="caption" color={palette.textFaint}>
                    {item.createdByName ? t('addedBy', { name: item.createdByName }) : t('unassigned')}
                  </Text>
                  <View style={styles.spacer} />
                  <Text variant="caption" color={palette.textFaint}>
                    {formatDate(item.createdAt, lang)}
                  </Text>
                </View>

                <View style={styles.row}>
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

                <Text variant="numeric" numeric style={styles.total}>
                  {blankIfZero(settled ? total : remaining)}{' '}
                  <Text variant="label" color={palette.textFaint}>
                    {t('soum')}
                  </Text>
                </Text>
              </Card>
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.xxl },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  spacer: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  breakdown: { marginTop: space.xs },
  total: { marginTop: space.md },
});
