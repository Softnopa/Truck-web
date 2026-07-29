import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { requestTrackingPermissions } from '@/lib/location';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

/**
 * Requirement: consent must be explicit, and the app must not be reachable
 * until the customer has answered one way or the other. Declining is a
 * first-class outcome — it is recorded, not punished.
 */
export default function Permissions() {
  const { t, accentColors } = usePrefs();
  const { saveConsent, consent } = useAuth();
  const [busy, setBusy] = useState(false);

  // Someone who already answered is here because the terms changed under them.
  const reconsenting = Boolean(consent?.decided_at);

  const decide = async (accept: boolean) => {
    setBusy(true);
    let location = false;
    let notifications = false;

    if (accept) {
      location = await requestTrackingPermissions();
      const notif = await Notifications.requestPermissionsAsync();
      notifications = notif.status === 'granted';
    }

    // Recorded with a timestamp whichever way it went — the answer itself is
    // what unblocks the app.
    await saveConsent({
      location_granted: location,
      notifications_granted: notifications,
      terms_accepted: true,
    });

    if (accept && (location || notifications)) haptics.saved();
    else haptics.tap();
    setBusy(false);
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <Text variant="display">{t('permTitle')}</Text>
          <Text variant="body" color={palette.textDim}>
            {t('permSubtitle')}
          </Text>
        </Animated.View>

        {reconsenting ? (
          <Animated.View entering={FadeInDown.delay(60).duration(400)}>
            <Card style={{ backgroundColor: palette.dangerSoft }}>
              <View style={styles.rowTop}>
                <View style={[styles.icon, { backgroundColor: palette.surface }]}>
                  <Ionicons name="alert-circle-outline" size={20} color={palette.danger} />
                </View>
                <Text variant="heading" color={palette.danger}>
                  {t('permChangedTitle')}
                </Text>
              </View>
              <Text variant="body" color={palette.text} style={styles.body}>
                {t('permChangedBody')}
              </Text>
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.delay(90).duration(400)}>
          <Card>
            <View style={styles.rowTop}>
              <View style={[styles.icon, { backgroundColor: accentColors.soft }]}>
                <Ionicons name="location-outline" size={20} color={accentColors.base} />
              </View>
              <Text variant="heading">{t('permLocationTitle')}</Text>
            </View>
            <Text variant="body" color={palette.textDim} style={styles.body}>
              {t('permLocationBody')}
            </Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(400)}>
          <Card>
            <View style={styles.rowTop}>
              <View style={[styles.icon, { backgroundColor: accentColors.soft }]}>
                <Ionicons name="notifications-outline" size={20} color={accentColors.base} />
              </View>
              <Text variant="heading">{t('permNotifTitle')}</Text>
            </View>
            <Text variant="body" color={palette.textDim} style={styles.body}>
              {t('permNotifBody')}
            </Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(210).duration(400)}>
          <Text variant="caption" color={palette.textFaint}>
            {t('permTerms')}
          </Text>
        </Animated.View>
      </ScrollView>

      <Animated.View entering={FadeInDown.delay(260).duration(400)} style={styles.actions}>
        <Button
          label={busy ? t('permAsking') : t('permAllow')}
          onPress={() => void decide(true)}
          loading={busy}
        />
        <Button
          label={t('permDecline')}
          variant="ghost"
          onPress={() => void decide(false)}
          disabled={busy}
        />
        <Text variant="caption" color={palette.textFaint} center>
          {t('permDeclineNote')}
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.xl, paddingBottom: space.lg, gap: space.base },
  header: { gap: space.sm, marginBottom: space.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { marginTop: space.md },
  // Primary action sits at the bottom, inside thumb reach.
  actions: { gap: space.sm, paddingTop: space.md, paddingBottom: space.sm },
});
