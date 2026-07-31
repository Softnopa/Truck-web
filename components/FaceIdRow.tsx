import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { FaceCamera, type FaceCameraHandle } from '@/components/FaceCamera';
import { REASON_STRING } from '@/components/FaceIdGate';
import { type ScanState } from '@/components/FaceScan';
import { ToggleRow } from '@/components/SettingRow';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { checkSupport, disable, enrol, isEnrolled, type Support } from '@/lib/faceId';
import { isEnrolled as platformEnrolled } from '@/lib/faceLock';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/** Enough angles of a still head to cover normal sitting, in under two seconds. */
const ENROL_PLAN = { frames: 8, intervalMs: 200 };

/**
 * Arms or disarms Face ID — the camera route, matched by the local service.
 *
 * Enrolment deliberately ends by dropping the local session, which throws the
 * owner straight at the lock screen. That is not a side effect to hide: it
 * clears the last plaintext copy of the token out of storage, and it makes them
 * prove the unlock works now rather than discovering it tomorrow morning.
 */
export function FaceIdRow() {
  const { t } = usePrefs();
  const theme = useTheme();
  const { profile } = useAuth();

  const camera = useRef<FaceCameraHandle>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [enrolled, setEnrolled] = useState(() => isEnrolled(profile?.id ?? null));
  const [sheet, setSheet] = useState(false);
  const [state, setState] = useState<ScanState>('idle');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-checked whenever the sheet opens: the service is a process the owner
  // starts and stops, so a check from app launch is often already stale.
  const refreshSupport = useCallback(() => {
    void checkSupport().then(setSupport);
  }, []);

  useEffect(refreshSupport, [refreshSupport]);

  useEffect(() => {
    setEnrolled(isEnrolled(profile?.id ?? null));
  }, [profile?.id]);

  const capture = useCallback(async () => {
    if (!profile || busy) return;
    setBusy(true);
    setState('scanning');
    setCaption(t('faceIdHoldStill'));

    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) return;

      const frames = await camera.current?.capture(ENROL_PLAN);
      if (!frames || frames.length === 0) {
        setState('failed');
        setCaption(t('faceIdNoCamera'));
        return;
      }

      const result = await enrol(
        profile.id,
        profile.full_name,
        { access_token: session.access_token, refresh_token: session.refresh_token },
        frames
      );

      if (!result.ok) {
        haptics.failed();
        setState('failed');
        setCaption(t(REASON_STRING[result.reason]));
        return;
      }

      haptics.saved();
      setState('success');
      setEnrolled(true);
      setSheet(false);

      // Local scope only: this must not revoke the refresh token that was just
      // sealed into the vault. It clears storage and nothing else, which drops
      // straight onto the lock screen so the unlock gets proven now.
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      setBusy(false);
    }
  }, [profile, busy, t]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (busy || !profile) return;
      if (!next) {
        setBusy(true);
        try {
          // Deletes the face id from the service too — the deliberate opposite
          // of signing out, which keeps it for the next time.
          await disable();
          setEnrolled(false);
          haptics.saved();
        } finally {
          setBusy(false);
        }
        return;
      }

      setState('idle');
      setCaption(t('faceIdEnrolHint'));
      refreshSupport();
      setSheet(true);
    },
    [busy, profile, t, refreshSupport]
  );

  // Native has the OS keystore and expo-local-authentication; a camera toggle
  // there would be a downgrade pretending to be a feature.
  if (Platform.OS !== 'web' || !support) return null;

  // Both backends seal the same session, so a second enrolment would overwrite
  // the vault the first is waiting on. One at a time, and say which.
  const otherArmed = platformEnrolled(profile?.id ?? null);
  const blocked = !support.ok || otherArmed;

  const description = otherArmed
    ? t('faceIdOtherArmed')
    : !support.ok
      ? t(
          support.reason === 'offline'
            ? 'faceIdOffline'
            : support.reason === 'insecure'
              ? 'faceUnlockInsecure'
              : 'faceIdNoCamera'
        )
      : enrolled
        ? t('faceUnlockSealed')
        : t('faceIdHint');

  return (
    <>
      <ToggleRow
        label={t('faceId')}
        description={description}
        value={enrolled}
        onChange={(next) => void toggle(next)}
        disabled={busy || (blocked && !enrolled)}
      />

      <Sheet visible={sheet} title={t('faceIdEnrol')} onClose={() => setSheet(false)}>
        <View style={styles.body}>
          <FaceCamera
            ref={camera}
            active={sheet}
            state={state}
            onFault={(fault) => {
              setState('failed');
              setCaption(t(fault === 'denied' ? 'faceIdCameraDenied' : 'faceIdNoCamera'));
            }}
          />
          <Text variant="label" color={state === 'failed' ? theme.danger : theme.textDim} center>
            {caption}
          </Text>
          <Button
            label={busy ? t('faceIdHoldStill') : t('faceIdCapture')}
            onPress={() => void capture()}
            loading={busy}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: space.base, paddingBottom: space.sm },
});
