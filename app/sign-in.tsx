import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { LANGUAGES, LANGUAGE_LABEL } from '@/i18n/strings';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

export default function SignIn() {
  const { t, lang, setLanguage, accentColors } = usePrefs();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) return setError(t('emailRequired'));
    if (!password) return setError(t('passwordRequired'));

    setError(null);
    setBusy(true);
    const failure = await signIn(email, password);
    setBusy(false);

    if (failure) {
      haptics.failed();
      setError(t('authFailed'));
      return;
    }
    haptics.saved();
  };

  return (
    <Screen keyboard>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(420)} style={styles.header}>
          <View style={[styles.mark, { backgroundColor: accentColors.soft }]}>
            <Text variant="title" color={accentColors.base}>
              T
            </Text>
          </View>
          <Text variant="display">{t('signInTitle')}</Text>
          <Text variant="body" color={palette.textDim}>
            {t('signInSubtitle')}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(90).duration(420)} style={styles.form}>
          <Field
            label={t('email')}
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            keyboardType="email-address"
          />
          <Field
            label={t('password')}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />

          {error ? (
            <Animated.View entering={FadeInUp.duration(220)} style={styles.error}>
              <Text variant="label" color={palette.danger}>
                {error}
              </Text>
            </Animated.View>
          ) : null}

          <Button label={t('signIn')} onPress={submit} loading={busy} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(180).duration(420)} style={styles.langBlock}>
          <Text variant="caption" color={palette.textFaint} center>
            {t('language').toUpperCase()}
          </Text>
          <Segmented
            options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
            value={lang}
            onChange={(next) => void setLanguage(next)}
          />
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xxl, gap: space.xxl },
  header: { gap: space.sm },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  form: { gap: space.base },
  error: {
    backgroundColor: palette.dangerSoft,
    borderRadius: radius.sm,
    padding: space.md,
  },
  langBlock: { gap: space.md },
});
