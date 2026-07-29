import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { listProfiles, updateProfile } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useLoader } from '@/lib/useLoader';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';

/** Owners correct a customer's name and phone. Role is not editable here. */
export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customerId = typeof id === 'string' ? id : '';
  const { t } = usePrefs();
  const router = useRouter();

  const { data } = useLoader(
    useCallback(
      async () => (await listProfiles()).find((p) => p.id === customerId) ?? null,
      [customerId]
    )
  );

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!data || filled) return;
    setName(data.full_name);
    setPhone(data.phone ?? '');
    setFilled(true);
  }, [data, filled]);

  const valid = name.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await updateProfile(customerId, {
        full_name: name.trim(),
        phone: phone.trim() || null,
      });
      haptics.saved();
      router.back();
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t('editCustomer')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <Field
            label={t('fullName')}
            value={name}
            onChangeText={setName}
            placeholder={t('fullName')}
            autoCapitalize="words"
            maxLength={60}
          />
          <Field
            label={t('phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="+998 90 123 45 67"
            keyboardType="phone-pad"
            maxLength={20}
          />
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
  footer: { paddingTop: space.md },
});
