import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { createClient } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';

const BOT_USERNAME = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;

export default function NewClient() {
  const { t } = usePrefs();
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
      const client = await createClient(profile.id, { name: name.trim(), phone: phone.trim() });
      haptics.saved();
      if (BOT_USERNAME) {
        const link = `https://t.me/${BOT_USERNAME}?start=${client.invite_code}`;
        void Share.share({ message: t('inviteMessage', { link }) });
      }
      router.back();
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t('newClient')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <Field
            label={t('clientName')}
            value={name}
            onChangeText={setName}
            placeholder={t('clientName')}
            autoCapitalize="words"
            maxLength={60}
            autoFocus
          />
          <Field
            label={t('clientPhone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="+998 90 123 45 67"
            keyboardType="phone-pad"
            maxLength={20}
          />
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
  footer: { paddingTop: space.md },
});
