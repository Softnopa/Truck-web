import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Badge, Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { deleteTruck, listTrucks } from '@/lib/api';
import { blankIfZero, num } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { haptics } from '@/lib/haptics';
import { truckRemaining, truckValue, type TruckDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { fruitEmoji, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { useSkin } from '@/theme/useSkin';

export default function Trucks() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const { fun } = useSkin();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listTrucks(), []));

  // Keeps this list in step with whatever the other owners are doing.
  useRealtime('trucks', ['trucks', 'sales'], reload);

  const trucks = data ?? [];

  const confirmDelete = (truck: TruckDoc) => {
    haptics.warn();
    Alert.alert(t('deleteTruck'), t('deleteTruckConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteTruck(truck.id);
            haptics.saved();
            await reload();
          })();
        },
      },
    ]);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header
        title={t('trucks')}
        subtitle={trucks.length > 0 ? t('boxesLeft', { n: num(totalRemaining(trucks)) }) : undefined}
        actionIcon="add"
        actionLabel={t('addTruck')}
        onAction={() => router.push('/new-truck')}
      />

      <FlatList
        data={trucks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={loading && trucks.length > 0}
        onRefresh={() => void reload()}
        ListEmptyComponent={
          loading ? null : <EmptyState icon="cube-outline" title={t('noTrucks')} hint={t('noTrucksHint')} />
        }
        renderItem={({ item, index }) => {
          const remaining = truckRemaining(item);
          const value = blankIfZero(truckValue(item));
          return (
            <Animated.View
              layout={LinearTransition.springify().damping(20)}
              entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}
            >
              {/* Tap edits, long-press deletes — a stray tap can never destroy a row. */}
              <PressableScale
                onPress={() => router.push(`/edit-truck?id=${item.id}`)}
                onLongPress={() => confirmDelete(item)}
                to={0.985}
                accessibilityLabel={item.truckNumber}
              >
                <Card>
                  <View style={styles.topRow}>
                    <Text variant="heading" numeric>
                      {item.truckNumber || t('none')}
                    </Text>
                    <Badge
                      label={
                        remaining > 0
                          ? t('boxesLeft', { n: num(remaining) })
                          : t('boxesSold', { n: num(item.boxesSold) })
                      }
                      color={remaining > 0 ? accentColors.base : theme.textDim}
                      soft={remaining > 0 ? accentColors.soft : theme.surfaceHi}
                    />
                  </View>

                  <View style={styles.metaRow}>
                    {fun ? (
                      <Text variant="body">{fruitEmoji(item.fruit)}</Text>
                    ) : (
                      <Ionicons name="nutrition-outline" size={16} color={theme.textFaint} />
                    )}
                    <Text variant="label" color={theme.textDim}>
                      {displayFruit(item.fruit, t) || t('none')}
                    </Text>
                  </View>

                  {value ? (
                    <Text variant="numeric" numeric style={styles.value}>
                      {value}{' '}
                      <Text variant="label" color={theme.textFaint}>
                        {t('soum')}
                      </Text>
                    </Text>
                  ) : null}

                  {item.createdByName ? (
                    <Text variant="caption" color={theme.textFaint} style={styles.author}>
                      {t('addedBy', { name: item.createdByName })}
                    </Text>
                  ) : null}
                </Card>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

function totalRemaining(trucks: TruckDoc[]): number {
  return trucks.reduce((sum, truck) => sum + truckRemaining(truck), 0);
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.xxl },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  value: { marginTop: space.md },
  author: { marginTop: space.md },
});
