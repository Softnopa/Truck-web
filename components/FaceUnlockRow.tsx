import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ToggleRow } from '@/components/SettingRow';
import { disable, enable, isEnrolled, isSupported } from '@/lib/faceLock';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';

/**
 * Arms or disarms face unlock for this browser.
 *
 * Enrolment deliberately ends by dropping the local session, which throws the
 * owner straight at the lock screen. That is not a side effect to hide: it
 * clears the last plaintext copy of the token out of localStorage, and it makes
 * them prove the unlock works now rather than discovering it tomorrow morning.
 */
export function FaceUnlockRow() {
  const { t } = usePrefs();
  const { profile } = useAuth();
  const [supported, setSupported] = useState(false);
  const [checked, setChecked] = useState(false);
  const [enrolled, setEnrolled] = useState(() => isEnrolled(profile?.id ?? null));
  const [noPrf, setNoPrf] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void isSupported().then((ok) => {
      if (!alive) return;
      setSupported(ok);
      setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setEnrolled(isEnrolled(profile?.id ?? null));
  }, [profile?.id]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (busy || !profile) return;
      setBusy(true);
      setNoPrf(false);
      try {
        if (!next) {
          disable();
          setEnrolled(false);
          haptics.saved();
          return;
        }

        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) return;

        const result = await enable(profile.id, profile.full_name, {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });

        if (!result.ok) {
          haptics.failed();
          if (result.reason === 'noPrf') setNoPrf(true);
          return;
        }

        haptics.saved();
        setEnrolled(true);

        // Local scope only: this must not revoke the refresh token that was
        // just sealed into the vault. It clears storage and nothing else, which
        // drops straight onto the lock screen so the unlock gets proven now.
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Cancelling the Windows Hello / Touch ID prompt lands here.
        haptics.failed();
      } finally {
        setBusy(false);
      }
    },
    [busy, profile]
  );

  // Native has the OS keystore already and should use expo-local-authentication;
  // showing a dead toggle there would just be a lie.
  if (Platform.OS !== 'web' || !checked || !supported) return null;

  const description = noPrf
    ? t('faceUnlockNoPrf')
    : enrolled
      ? t('faceUnlockSealed')
      : t('faceUnlockHint');

  return (
    <ToggleRow
      label={t('faceUnlock')}
      description={description}
      value={enrolled}
      onChange={(next) => void toggle(next)}
      disabled={busy}
    />
  );
}
