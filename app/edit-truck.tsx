import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { FruitPicker } from '@/components/FruitPicker';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { getTruck, updateTruck } from '@/lib/api';
import { blankIfZero, formatPlate, num, parseAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useLoader } from '@/lib/useLoader';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export default function EditTruck() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const truckId = typeof id === 'string' ? id : '';
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const router = useRouter();

  const { data } = useLoader(useCallback(() => getTruck(truckId), [truckId]));

  const [plate, setPlate] = useState('');
  const [fruit, setFruit] = useState('');
  const [boxes, setBoxes] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState(false);

  // Seed the form once the record arrives, then leave the user's edits alone.
  useEffect(() => {
    if (!data || filled) return;
    setPlate(data.truckNumber);
    setFruit(data.fruit);
    setBoxes(data.boxes > 0 ? String(data.boxes) : '');
    setPrice(data.pricePerBox > 0 ? String(data.pricePerBox) : '');
    setFilled(true);
  }, [data, filled]);

  const boxCount = parseAmount(boxes);
  const unitPrice = parseAmount(price);
  const total = boxCount && unitPrice ? boxCount * unitPrice : null;
  const valid =
    plate.trim().length >= 3 && fruit.trim().length > 0 && boxCount !== null && unitPrice !== null;

  const save = async () => {
    if (!valid || boxCount === null || unitPrice === null) return;
    setBusy(true);
    try {
      await updateTruck(truckId, {
        truckNumber: plate.trim(),
        fruit: fruit.trim().toLowerCase(),
        boxes: boxCount,
        pricePerBox: unitPrice,
      });
      haptics.saved();
      router.back();
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  const sold = data?.boxesSold ?? 0;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t('editTruck')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <Field
            label={t('truckNumber')}
            value={plate}
            onChangeText={(v) => setPlate(formatPlate(v))}
            placeholder="01 A123AA"
            autoCapitalize="characters"
            maxLength={10}
          />

          <FruitPicker value={fruit} onChange={setFruit} />

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

          {sold > 0 ? (
            <Text variant="caption" color={theme.textFaint}>
              {t('boxesSold', { n: num(sold) })}
            </Text>
          ) : null}

          {total ? (
            <Animated.View
              entering={FadeInDown.duration(260)}
              style={[styles.total, { backgroundColor: accentColors.soft }]}
            >
              <Text variant="caption" color={accentColors.base}>
                {t('totalValue').toUpperCase()}
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
        <Button
          label={busy ? t('saving') : t('saveChanges')}
          onPress={save}
          disabled={!valid}
          loading={busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  total: { borderRadius: radius.md, padding: space.base, gap: space.xs },
  footer: { paddingTop: space.md },
});
