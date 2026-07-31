import { Platform, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Card, Divider, SectionHeader } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { AccentPicker } from '@/components/AccentPicker';
import { FaceIdRow } from '@/components/FaceIdRow';
import { FaceUnlockRow } from '@/components/FaceUnlockRow';
import { ScreenLockRow } from '@/components/ScreenLockRow';
import { SettingBlock, SettingRow } from '@/components/SettingRow';
import { Text } from '@/components/Text';
import { LANGUAGES, LANGUAGE_LABEL } from '@/i18n/strings';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { TEXT_SCALES, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/** Owner-only customization. Every value is persisted per user in Supabase. */
export default function OwnerSettings() {
  const { t, lang, accent, textScale, fun, theme: themeMode, setLanguage, setAccent, setTextScale, setFun, setTheme } =
    usePrefs();
  const { profile, signOut } = useAuth();
  const theme = useTheme();

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header title={t('settings')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <SectionHeader title={t('appearance')} />
          <Card>
            <SettingBlock label={t('language')}>
              <Segmented
                options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
                value={lang}
                onChange={(next) => void setLanguage(next)}
              />
            </SettingBlock>

            <Divider />

            <SettingBlock label={t('theme')}>
              <Segmented
                options={[
                  { value: 'light' as const, label: t('themeLight') },
                  { value: 'system' as const, label: t('themeSystem') },
                  { value: 'dark' as const, label: t('themeDark') },
                ]}
                value={themeMode}
                onChange={(next) => void setTheme(next)}
              />
              <Text variant="caption" color={theme.textFaint}>
                {t('themeHint')}
              </Text>
            </SettingBlock>

            <Divider />

            <SettingBlock label={t('skin')}>
              <Segmented
                options={[
                  { value: 0, label: t('skinCalm') },
                  { value: 1, label: t('skinFun') },
                ]}
                value={fun ? 1 : 0}
                onChange={(next) => void setFun(next === 1)}
              />
              <Text variant="caption" color={theme.textFaint}>
                {t('skinHint')}
              </Text>
            </SettingBlock>

            <Divider />

            <SettingBlock label={t('accentColor')}>
              <AccentPicker value={accent} onChange={(next) => void setAccent(next)} />
            </SettingBlock>

            <Divider />

            <SettingBlock label={t('textSize')}>
              <Segmented
                options={TEXT_SCALES.map((s) => ({ value: s, label: `${Math.round(s * 100)}%` }))}
                value={textScale}
                onChange={(next) => void setTextScale(next)}
              />
              <Text variant="body" color={theme.textDim}>
                {t('textSizeSample')}
              </Text>
            </SettingBlock>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(90).duration(320)}>
          <SectionHeader title={t('account')} />
          <Card>
            <SettingRow label={profile?.full_name ?? t('none')} description={t('roleOwner')} />
            <Divider />
            <ScreenLockRow />
            {/* Browser only: these two arm an extra face check that seals the
                session in localStorage. A phone keeps its session in the
                keystore and gets Face ID from the OS, so neither belongs there
                — and the dividers must go with them, or the card ends in two
                rules over nothing. */}
            {Platform.OS === 'web' ? (
              <>
                <Divider />
                <FaceUnlockRow />
                <Divider />
                <FaceIdRow />
              </>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(320)} style={styles.signOut}>
          <Button label={t('signOut')} variant="secondary" onPress={() => void signOut()} />
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  signOut: { marginTop: space.xl },
});
