import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { FruitPicker } from '@/components/FruitPicker';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { createTruck } from '@/lib/api';
import { blankIfZero, formatPlate, parseAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

/**
 * Four inputs. The old form had ten plus three custom fields; arrival date is
 * now simply today, and weight/unit/photo/custom fields are gone.
 */
export default function NewTruck() {
  const { t, accentColors } = usePrefs();
  const { profile } = useAuth();
  const router = useRouter();

  const [plate, setPlate] = useState('');
  const [fruit, setFruit] = useState('');
  const [boxes, setBoxes] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const boxCount = parseAmount(boxes);
  const unitPrice = parseAmount(price);
  const total = boxCount && unitPrice ? boxCount * unitPrice : null;
  const valid = plate.trim().length >= 3 && fruit.trim().length > 0 && boxCount !== null && unitPrice !== null;

  const save = async () => {
    if (!valid || !profile || boxCount === null || unitPrice === null) return;
    setBusy(true);
    try {
      await createTruck(
        {
          truckNumber: plate.trim(),
          fruit: fruit.trim().toLowerCase(),
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
      <Header title={t('newTruck')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <Field
            label={t('truckNumber')}
            value={plate}
            onChangeText={(v) => setPlate(formatPlate(v))}
            placeholder="01 A123AA"
            autoCapitalize="characters"
            maxLength={10}
            autoFocus
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

          {/* Computed, never an input, and hidden entirely while it would read 0. */}
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
        <Button label={busy ? t('saving') : t('save')} onPress={save} disabled={!valid} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  total: {
    borderRadius: radius.md,
    padding: space.base,
    gap: space.xs,
  },
  footer: { paddingTop: space.md, borderTopColor: palette.border },
});
