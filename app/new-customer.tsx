import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { createCustomer, createRandomSale, listTrucks } from '@/lib/api';
import { blankIfZero, num, parseAmount } from '@/lib/format';
import { displayFruit } from '@/lib/fruits';
import { haptics } from '@/lib/haptics';
import { truckRemaining, type TruckDoc } from '@/lib/types';
import { useLoader } from '@/lib/useLoader';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

type Kind = 'random' | 'special';

/**
 * The two ways a buyer arrives.
 *
 * **Random** is the roadside sale: someone stops, buys boxes, pays, leaves.
 * There is no name worth typing, so the form asks only what was actually sold,
 * and the sale is settled the moment it is written — an anonymous buyer cannot
 * be phoned or chased, so a debt against one would only ever inflate a total
 * the owners steer by. It is the default because it is the common case.
 *
 * **Special** is the buyer who comes back: a name, a phone, and a running
 * balance. That one is worth a record of their own.
 */
export default function NewCustomer() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const { profile } = useAuth();
  const router = useRouter();

  const [kind, setKind] = useState<Kind>('random');
  const random = kind === 'random';

  // Special
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Random
  const [truck, setTruck] = useState<TruckDoc | null>(null);
  const [boxes, setBoxes] = useState('');
  const [price, setPrice] = useState('');

  const [busy, setBusy] = useState(false);

  // Only the trucks with something left on them can be sold from.
  const { data: trucks } = useLoader(
    useCallback(async () => (await listTrucks()).filter((tr) => truckRemaining(tr) > 0), [])
  );

  const boxCount = parseAmount(boxes);
  const unitPrice = parseAmount(price);
  const total = boxCount !== null && unitPrice !== null ? boxCount * unitPrice : null;

  const valid = random
    ? truck !== null && boxCount !== null && unitPrice !== null
    : name.trim().length > 0;

  const pickTruck = (next: TruckDoc) => {
    setTruck(next);
    // Pre-fills the asking price, still fully editable.
    if (!price) setPrice(String(next.pricePerBox));
  };

  const save = async () => {
    if (!valid || !profile) return;
    setBusy(true);
    try {
      if (random) {
        if (!truck || boxCount === null || unitPrice === null) return;
        await createRandomSale(
          {
            bucketName: t('randomCustomer'),
            truckId: truck.id,
            fruit: truck.fruit,
            boxes: boxCount,
            pricePerBox: unitPrice,
          },
          { id: profile.id, name: profile.full_name }
        );
        haptics.saved();
        router.back();
        return;
      }

      const customer = await createCustomer(
        { name: name.trim(), phone: phone.trim() },
        { id: profile.id, name: profile.full_name }
      );
      haptics.saved();
      // You add someone because you are about to sell to them, so land on their
      // page, where the sale button is. `replace` keeps Back going to the list.
      router.replace(`/customer/${customer.id}`);
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t(random ? 'newSale' : 'newCustomer')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <View style={styles.group}>
            <Text variant="label" color={theme.textDim}>
              {t('customerKind')}
            </Text>
            <Segmented
              options={[
                { value: 'random' as Kind, label: t('kindRandom') },
                { value: 'special' as Kind, label: t('kindSpecial') },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Text variant="caption" color={theme.textFaint}>
              {t(random ? 'kindRandomHint' : 'kindSpecialHint')}
            </Text>
          </View>

          {random ? (
            <>
              <View style={styles.group}>
                <Text variant="label" color={theme.textDim}>
                  {t('selectTruck')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}
                  keyboardShouldPersistTaps="handled"
                >
                  {(trucks ?? []).map((item) => {
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
                            backgroundColor: active ? accentColors.base : theme.surface,
                            borderColor: active ? accentColors.base : theme.border,
                          },
                        ]}
                      >
                        <Text variant="label" numeric color={active ? accentColors.on : theme.text}>
                          {item.truckNumber}
                        </Text>
                        <Text variant="caption" color={active ? accentColors.on : theme.textFaint}>
                          {displayFruit(item.fruit, t)} ·{' '}
                          {t('boxesLeft', { n: num(truckRemaining(item)) })}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
                {(trucks ?? []).length === 0 ? (
                  <Text variant="caption" color={theme.warning}>
                    {t('noTrucksToSell')}
                  </Text>
                ) : null}
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
                  {/* Said plainly, because it is the part that surprises: this
                      sale is closed the moment it is saved. */}
                  <Text variant="caption" color={accentColors.base}>
                    {t('randomPaidNote')}
                  </Text>
                </Animated.View>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label={t('fullName')}
                value={name}
                onChangeText={setName}
                placeholder={t('fullName')}
                autoCapitalize="words"
                maxLength={60}
                autoFocus
              />
              <Field
                label={t('phone')}
                value={phone}
                onChangeText={setPhone}
                placeholder="+998 90 123 45 67"
                keyboardType="phone-pad"
                maxLength={20}
              />

              <Text variant="caption" color={theme.textDim}>
                {t('newCustomerHint')}
              </Text>
            </>
          )}
        </Animated.View>
      </FormScroll>

      <View style={styles.footer}>
        <Button
          label={busy ? t('saving') : t('save')}
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
