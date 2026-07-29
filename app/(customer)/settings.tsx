import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Card, Divider, SectionHeader } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { SettingBlock, SettingRow, ToggleRow } from '@/components/SettingRow';
import { Text } from '@/components/Text';
import { LANGUAGES, LANGUAGE_LABEL } from '@/i18n/strings';
import { formatDate } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { requestTrackingPermissions } from '@/lib/location';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { ACCENTS, palette, space } from '@/theme/tokens';

/**
 * Limited by design: a customer picks their own language, but appearance is
 * owner-controlled. Consent stays revocable here for the life of the account.
 */
export default function CustomerSettings() {
  const { t, lang, accent, textScale, fun, setLanguage, setFun } = usePrefs();
  const { profile, consent, signOut, revokeLocation } = useAuth();
  const [busy, setBusy] = useState(false);

  const sharing = Boolean(consent?.location_granted && !consent.revoked_at);

  const consentDetail = consent?.revoked_at
    ? t('consentRevokedOn', { date: formatDate(consent.revoked_at, lang) })
    : consent?.decided_at && consent.location_granted
      ? t('consentGrantedOn', { date: formatDate(consent.decided_at, lang) })
      : t('consentNever');

  const toggleSharing = async (next: boolean) => {
    setBusy(true);
    if (next) {
      // Re-granting needs the OS permissions back as well as the DB flag, and
      // background is what actually makes continuous sharing work.
      const granted = await requestTrackingPermissions();
      if (!granted) {
        haptics.failed();
        setBusy(false);
        return;
      }
    }
    await revokeLocation(!next);
    haptics.saved();
    setBusy(false);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header title={t('settings')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <SectionHeader title={t('privacy')} />
          <Card>
            <ToggleRow
              label={t('locationSharing')}
              description={consentDetail}
              value={sharing}
              onChange={(next) => void toggleSharing(next)}
              disabled={busy}
            />
            <Divider />
            <SettingRow
              label={t('notificationsSetting')}
              description={
                consent?.notifications_granted ? t('resultLocated') : t('resultDenied')
              }
            />
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(90).duration(320)}>
          <SectionHeader title={t('language')} />
          <Card>
            <SettingBlock label={t('language')}>
              <Segmented
                options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
                value={lang}
                onChange={(next) => void setLanguage(next)}
              />
            </SettingBlock>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(320)}>
          <SectionHeader title={t('appearance')} />
          <Card>
            {/* The skin is personal to this device, so customers get it too. */}
            <SettingBlock label={t('skin')}>
              <Segmented
                options={[
                  { value: 0, label: t('skinCalm') },
                  { value: 1, label: t('skinFun') },
                ]}
                value={fun ? 1 : 0}
                onChange={(next) => void setFun(next === 1)}
              />
            </SettingBlock>
            <Divider />
            {/* Read-only mirror of what the owners chose. */}
            <SettingRow label={t('accentColor')}>
              <Text variant="label" color={ACCENTS[accent].base}>
                ●
              </Text>
            </SettingRow>
            <Divider />
            <SettingRow label={t('textSize')} description={`${Math.round(textScale * 100)}%`} />
            <Divider />
            <Text variant="caption" color={palette.textFaint}>
              {t('customerSettingsNote')}
            </Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(210).duration(320)}>
          <SectionHeader title={t('account')} />
          <Card>
            <SettingRow label={profile?.full_name ?? t('none')} description={t('roleCustomer')} />
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(260).duration(320)} style={styles.signOut}>
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
