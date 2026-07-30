import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { FaceScan, type ScanState } from '@/components/FaceScan';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { disable as disableFaceLock, unlock } from '@/lib/faceLock';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Props {
  /** Called once a session is live again, so the gate can stand down. */
  onUnlocked: () => void;
  /** Abandon the vault and go back to email and password. */
  onUsePassword: () => void;
}

/**
 * The gate shown when a sealed session is waiting. Nothing here is decorative
 * security: with PRF the refresh token really is ciphertext until the
 * authenticator returns the key, so failing this screen leaves nothing to use.
 *
 * The scan is tap-to-start rather than automatic. Chrome refuses
 * `navigator.credentials.get()` without user activation often enough that an
 * auto-attempt would just paint a spurious failure on first paint.
 */
export function LockScreen({ onUnlocked, onUsePassword }: Props) {
  const { t } = usePrefs();
  const theme = useTheme();
  const [state, setState] = useState<ScanState>('idle');

  const caption =
    state === 'scanning'
      ? t('faceLookAtCamera')
      : state === 'failed'
        ? t('faceNotRecognised')
        : state === 'success'
          ? t('faceUnlocked')
          : t('faceTapToUnlock');

  const run = useCallback(async () => {
    if (state === 'scanning' || state === 'success') return;
    setState('scanning');

    const tokens = await unlock();

    if (!tokens) {
      haptics.failed();
      setState('failed');
      return;
    }

    const { error } = await supabase.auth.setSession(tokens);
    if (error) {
      // The sealed refresh token no longer works — revoked, or expired while
      // the app sat unopened. Nothing here can recover it, so clear the
      // enrolment and fall back to the password rather than loop forever.
      haptics.failed();
      disableFaceLock();
      setState('failed');
      onUsePassword();
      return;
    }

    haptics.saved();
    setState('success');
    onUnlocked();
  }, [state, onUnlocked, onUsePassword]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Animated.View entering={FadeIn.duration(260)} style={styles.wrap}>
        <PressableScale
          onPress={() => void run()}
          to={0.96}
          accessibilityLabel={t('faceUnlock')}
          disabled={state === 'scanning' || state === 'success'}
        >
          <FaceScan state={state} />
        </PressableScale>

        <Animated.View entering={FadeInDown.delay(80).duration(320)} style={styles.copy}>
          <Text variant="title">{t('faceUnlock')}</Text>
          <Text variant="label" color={state === 'failed' ? theme.danger : theme.textDim}>
            {caption}
          </Text>
        </Animated.View>
      </Animated.View>

      <View style={styles.footer}>
        <Button
          label={state === 'failed' ? t('faceTryAgain') : t('faceUnlockAction')}
          onPress={() => void run()}
          loading={state === 'scanning'}
          disabled={state === 'success'}
        />
        <Button label={t('usePassword')} variant="secondary" onPress={onUsePassword} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  copy: { alignItems: 'center', gap: space.xs },
  footer: { paddingTop: space.md, gap: space.md },
});
