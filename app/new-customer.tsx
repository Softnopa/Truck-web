import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { createCustomer } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * Adds a buyer who has no account and never will. The counterpart to the
 * customers that arrive on their own by signing in — see migration 0006.
 */
export default function NewCustomer() {
  const { t } = usePrefs();
  const theme = useTheme();
  const { profile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0;

  const save = async () => {
    if (!valid || !profile) return;
    setBusy(true);
    try {
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
      <Header title={t('newCustomer')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
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
  footer: { paddingTop: space.md },
});
