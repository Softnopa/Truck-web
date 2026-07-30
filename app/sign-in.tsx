import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Text } from '@/components/Text';
import { LANGUAGES, LANGUAGE_LABEL } from '@/i18n/strings';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, radius, space, type ThemeMode } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/** Auto sits in the middle: the two ends are the explicit overrides. */
const THEME_CYCLE: ThemeMode[] = ['light', 'system', 'dark'];

const THEME_ICON: Record<ThemeMode, keyof typeof Ionicons.glyphMap> = {
  light: 'sunny',
  system: 'phone-portrait-outline',
  dark: 'moon',
};

export default function SignIn() {
  const { t, lang, setLanguage, accentColors, theme: themeMode, setTheme } = usePrefs();
  const theme = useTheme();
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

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
    if (next) void setTheme(next);
  };

  return (
    <Screen keyboard>
      {/* Out of the way of the form, but reachable before anyone signs in —
          this is the only screen a customer sees before their prefs load. */}
      <View style={styles.themeBar}>
        <PressableScale
          onPress={cycleTheme}
          haptic="select"
          to={0.9}
          accessibilityLabel={`${t('theme')}: ${t(
            themeMode === 'dark' ? 'themeDark' : themeMode === 'light' ? 'themeLight' : 'themeSystem'
          )}`}
          style={[styles.themeButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Ionicons name={THEME_ICON[themeMode]} size={18} color={theme.textDim} />
          <Text variant="caption" color={theme.textDim}>
            {t(
              themeMode === 'dark'
                ? 'themeDark'
                : themeMode === 'light'
                  ? 'themeLight'
                  : 'themeSystem'
            )}
          </Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(420)} style={styles.header}>
          {/* The artwork is a cutout with its own colour, so it stands on the
              page rather than inside an accent-tinted chip the way the old
              letter mark did. */}
          <Image
            source={require('@/assets/truck.png')}
            style={styles.mark}
            resizeMode="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('appName')}
          />
          {/* Wordmark above the greeting: the eyebrow names the product once,
              in caps, so the display line can be a sentence rather than a label. */}
          <Text variant="caption" color={accentColors.base} style={styles.eyebrow}>
            {t('appName').toUpperCase()}
          </Text>
          <Text variant="display">{t('signInTitle')}</Text>
          <Text variant="body" color={theme.textDim} style={styles.subtitle}>
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
            <Animated.View entering={FadeInUp.duration(220)} style={[styles.error, { backgroundColor: theme.dangerSoft }]}>
              <Text variant="label" color={theme.danger}>
                {error}
              </Text>
            </Animated.View>
          ) : null}

          <Button label={t('signIn')} onPress={submit} loading={busy} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(180).duration(420)} style={styles.langBlock}>
          <Text variant="caption" color={theme.textFaint} center>
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
  themeBar: { alignItems: 'flex-end', paddingTop: space.sm },
  themeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: HIT - 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl, gap: space.xxl },
  header: { gap: space.xs },
  eyebrow: { letterSpacing: 1.6, marginBottom: space.xs },
  subtitle: { marginTop: space.xs },
  // 3:2, matching the source art, so `contain` leaves no dead space around it.
  mark: {
    width: 132,
    height: 88,
    marginBottom: space.md,
    marginLeft: -space.xs,
  },
  form: { gap: space.base },
  error: {
    borderRadius: radius.sm,
    padding: space.md,
  },
  langBlock: { gap: space.md },
});
