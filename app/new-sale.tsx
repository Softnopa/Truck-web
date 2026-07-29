import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { createSale, listProfiles, listTrucks } from '@/lib/api';
import { blankIfZero, num, parseAmount } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { haptics } from '@/lib/haptics';
import { truckRemaining, type TruckDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

async function loadForm(customerId: string) {
  const [trucks, profiles] = await Promise.all([listTrucks(), listProfiles()]);
  return {
    trucks: trucks.filter((tr) => truckRemaining(tr) > 0),
    customerName: profiles.find((p) => p.id === customerId)?.full_name ?? '',
  };
}

export default function NewSale() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const id = typeof customerId === 'string' ? customerId : '';
  const { t, accentColors } = usePrefs();
  const { profile } = useAuth();
  const router = useRouter();

  const { data } = useLoader(useCallback(() => loadForm(id), [id]));

  const [truck, setTruck] = useState<TruckDoc | null>(null);
  const [boxes, setBoxes] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const boxCount = parseAmount(boxes);
  const unitPrice = parseAmount(price);
  const total = boxCount && unitPrice ? boxCount * unitPrice : null;
  const valid = truck !== null && boxCount !== null && unitPrice !== null;

  const pickTruck = (next: TruckDoc) => {
    setTruck(next);
    // Pre-fills the asking price, still fully editable.
    if (!price) setPrice(String(next.pricePerBox));
  };

  const save = async () => {
    if (!valid || !profile || !truck || boxCount === null || unitPrice === null) return;
    setBusy(true);
    try {
      await createSale(
        {
          customerId: id,
          customerName: data?.customerName ?? '',
          truckId: truck.id,
          fruit: truck.fruit,
          boxes: boxCount,
          pricePerBox: unitPrice,
        },
        { id: profile.id, name: profile.full_name }
      );
      haptics.saved();
      router.back();
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t('newSale')} subtitle={data?.customerName} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <View style={styles.group}>
            <Text variant="label" color={palette.textDim}>
              {t('selectTruck')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              {(data?.trucks ?? []).map((item) => {
                const active = truck?.id === item.id;
                return (
                  <PressableScale
                    key={item.id}
                    onPress={() => pickTruck(item)}
                    haptic="select"
                    to={0.94}
                    accessibilityLabel={item.truckNumber}
                    style={[
                      styles.truckChip,
                      {
                        backgroundColor: active ? accentColors.base : palette.surface,
                        borderColor: active ? accentColors.base : palette.border,
                      },
                    ]}
                  >
                    <Text variant="label" numeric color={active ? accentColors.on : palette.text}>
                      {item.truckNumber}
                    </Text>
                    <Text
                      variant="caption"
                      color={active ? accentColors.on : palette.textFaint}
                    >
                      {displayFruit(item.fruit, t)} · {t('boxesLeft', { n: num(truckRemaining(item)) })}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.pair}>
            <View style={styles.half}>
              <Field
                label={t('boxes')}
                value={boxes}
                onChangeText={setBoxes}
                placeholder={t('boxes')}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <View style={styles.half}>
              <Field
                label={t('pricePerBox')}
                value={price}
                onChangeText={setPrice}
                placeholder={t('pricePerBox')}
                keyboardType="number-pad"
                suffix={t('soum')}
                maxLength={12}
              />
            </View>
          </View>

          {total ? (
            <Animated.View
              entering={FadeInDown.duration(260)}
              style={[styles.total, { backgroundColor: accentColors.soft }]}
            >
              <Text variant="caption" color={accentColors.base}>
                {t('total').toUpperCase()}
              </Text>
              <Text variant="numeric" numeric color={accentColors.base}>
                {blankIfZero(total)}{' '}
                <Text variant="label" color={accentColors.base}>
                  {t('soum')}
                </Text>
              </Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </FormScroll>

      <View style={styles.footer}>
        <Button label={busy ? t('saving') : t('save')} onPress={save} disabled={!valid} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  group: { gap: space.md },
  chips: { gap: space.sm, paddingRight: space.lg },
  truckChip: {
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
    minWidth: 140,
  },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  total: { borderRadius: radius.md, padding: space.base, gap: space.xs },
  footer: { paddingTop: space.md },
});
