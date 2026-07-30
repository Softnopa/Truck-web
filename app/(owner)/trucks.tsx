import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Badge, Card, Divider } from '@/components/Card';
import { Confirm } from '@/components/Confirm';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { deleteTruck, listTrucks } from '@/lib/api';
import { blankIfZero, formatDate, formatDateTime, num } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { haptics } from '@/lib/haptics';
import { truckRemaining, truckValue, type TruckDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { fruitEmoji, HIT, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';
import { useTheme } from '@/theme/useTheme';

/** Round card buttons: just under the 44pt minimum's visual weight, still on it. */
const BUTTON = HIT - 4;

export default function Trucks() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const { fun } = useSkin();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listTrucks(), []));

  // Keeps this list in step with whatever the other owners are doing.
  useRealtime('trucks', ['trucks', 'sales'], reload);

  /** The truck whose full record is open. Tapping a card is a read, not an edit. */
  const [detail, setDetail] = useState<TruckDoc | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TruckDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const trucks = data ?? [];

  const askDelete = (truck: TruckDoc) => {
    haptics.warn();
    if (detail) {
      // Coming from the detail sheet: let its modal finish dismissing first. A
      // second modal presented in the same frame as the first one closes never
      // appears on iOS.
      setDetail(null);
      setTimeout(() => setPendingDelete(truck), 260);
      return;
    }
    setPendingDelete(truck);
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteTruck(pendingDelete.id);
      haptics.saved();
      await reload();
    } catch {
      haptics.failed();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const edit = (truck: TruckDoc) => {
    setDetail(null);
    router.push(`/edit-truck?id=${truck.id}`);
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
              {/* The pen is a sibling of the card, not a child of its pressable:
                  nesting one pressable inside another makes a tap on the pen
                  count as a tap on the card as well. */}
              <View>
                <PressableScale
                  onPress={() => setDetail(item)}
                  onLongPress={() => askDelete(item)}
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

                    {/* Holds the space the buttons float over, so nothing
                        collides with them however long the author's name is. */}
                    <View style={styles.footRow}>
                      <View style={styles.actionsSlot} />
                      {item.createdByName ? (
                        <Text
                          variant="caption"
                          color={theme.textFaint}
                          numberOfLines={1}
                          style={styles.author}
                        >
                          {t('addedBy', { name: item.createdByName })}
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                </PressableScale>

                {/* Both sit over the card rather than inside its pressable.
                    Delete is spelled out here as well as on long-press: with a
                    mouse there is nothing to hold, so long-press alone hid it. */}
                <View style={styles.actions}>
                  <PressableScale
                    onPress={() => edit(item)}
                    to={0.9}
                    accessibilityLabel={`${t('editTruck')} ${item.truckNumber}`}
                    style={[styles.iconBtn, { backgroundColor: accentColors.soft }]}
                  >
                    <Ionicons name="create-outline" size={20} color={accentColors.base} />
                  </PressableScale>

                  <PressableScale
                    onPress={() => askDelete(item)}
                    to={0.9}
                    haptic="none"
                    accessibilityLabel={`${t('deleteTruck')} ${item.truckNumber}`}
                    style={[styles.iconBtn, { backgroundColor: theme.dangerSoft }]}
                  >
                    <Ionicons name="trash-outline" size={19} color={theme.danger} />
                  </PressableScale>
                </View>
              </View>
            </Animated.View>
          );
        }}
      />

      <TruckSheet
        truck={detail}
        onClose={() => setDetail(null)}
        onEdit={edit}
        onDelete={askDelete}
      />

      <Confirm
        visible={pendingDelete !== null}
        title={t('deleteTruck')}
        message={
          pendingDelete
            ? `${pendingDelete.truckNumber || t('none')} · ${t('deleteTruckConfirm')}`
            : t('deleteTruckConfirm')
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        busy={deleting}
        onConfirm={() => void runDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

/** Everything the record holds, for the owner who tapped the card to read it. */
function TruckSheet({
  truck,
  onClose,
  onEdit,
  onDelete,
}: {
  truck: TruckDoc | null;
  onClose: () => void;
  onEdit: (truck: TruckDoc) => void;
  onDelete: (truck: TruckDoc) => void;
}) {
  const { t, lang, accentColors } = usePrefs();
  const theme = useTheme();
  const { fun } = useSkin();
  const { height } = useWindowDimensions();

  /** Money with its unit, or an em dash — the app never prints a bare zero. */
  const money = (value: number): string => {
    const shown = blankIfZero(value);
    return shown ? `${shown} ${t('soum')}` : t('none');
  };

  // The sheet holds a fixed set of rows, but they grow with the text-size
  // preference — past half the screen they scroll rather than push the buttons
  // out of reach.
  const maxHeight = Math.round(height * 0.45);

  const remaining = truck ? truckRemaining(truck) : 0;
  const sold = truck?.boxesSold ?? 0;
  const price = truck?.pricePerBox ?? 0;

  return (
    <Sheet
      visible={truck !== null}
      title={truck ? truck.truckNumber || t('none') : ''}
      onClose={onClose}
    >
      {truck ? (
        <>
          <ScrollView style={{ maxHeight }} showsVerticalScrollIndicator={false}>
            <DetailRow
              label={t('fruit')}
              value={`${fun ? `${fruitEmoji(truck.fruit)} ` : ''}${displayFruit(truck.fruit, t) || t('none')}`}
            />
            <DetailRow label={t('boxes')} value={num(truck.boxes)} />
            <DetailRow label={t('sold')} value={num(sold)} />
            <DetailRow
              label={t('left')}
              value={num(remaining)}
              color={remaining > 0 ? theme.text : theme.textDim}
            />

            <Divider />

            <DetailRow label={t('pricePerBox')} value={money(price)} />
            <DetailRow label={t('totalValue')} value={money(truckValue(truck))} />
            <DetailRow label={t('soldValue')} value={money(sold * price)} />
            <DetailRow label={t('remainingValue')} value={money(remaining * price)} />

            <Divider />

            <DetailRow label={t('arrived')} value={formatDate(truck.arrivalDate, lang) || t('none')} />
            <DetailRow
              label={t('addedByLabel')}
              value={truck.createdByName || t('unassigned')}
            />
            <DetailRow label={t('lastUpdated')} value={formatDateTime(truck.updatedAt, lang)} />
          </ScrollView>

          <Button
            label={t('editTruck')}
            onPress={() => onEdit(truck)}
            icon={<Ionicons name="create-outline" size={20} color={accentColors.on} />}
          />
          <Button label={t('deleteTruck')} variant="ghost" onPress={() => onDelete(truck)} />
        </>
      ) : null}
    </Sheet>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text variant="label" color={theme.textDim}>
        {label}
      </Text>
      <Text variant="label" numeric color={color ?? theme.text} style={styles.detailValue}>
        {value}
      </Text>
    </View>
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
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  // Two buttons plus the gap between them: BUTTON * 2 + space.sm.
  actionsSlot: { width: BUTTON * 2 + space.sm, height: BUTTON },
  author: { flex: 1, textAlign: 'right' },
  actions: {
    position: 'absolute',
    left: space.base,
    bottom: space.base,
    flexDirection: 'row',
    gap: space.sm,
  },
  iconBtn: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.base,
    paddingVertical: space.sm,
  },
  detailValue: { flexShrink: 1, textAlign: 'right' },
});
