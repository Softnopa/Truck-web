import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceIdGate } from '@/components/FaceIdGate';
import { FaceScan, type ScanState } from '@/components/FaceScan';
import { GateLayout } from '@/components/GateLayout';
import { lockedBackend } from '@/lib/faceGate';
import { disable as disableFaceLock, unlock } from '@/lib/faceLock';
import { haptics } from '@/lib/haptics';
import { markScreenUnlocked } from '@/lib/screenLock';
import { supabase } from '@/lib/supabase';
import { usePrefs } from '@/providers/PreferencesProvider';

interface Props {
  /** Called once a session is live again, so the gate can stand down. */
  onUnlocked: () => void;
  /** The sealed session turned out to be dead — nothing but the password is left. */
  onUsePassword: () => void;
  /** Runs the check as soon as the block appears, without waiting for a tap. */
  auto?: boolean;
}

/**
 * The face check standing over a sealed session, as a block on the login page.
 *
 * Which check depends on what sealed it. Both are real locks rather than hidden
 * screens: the refresh token is ciphertext until the check returns a key, so
 * failing this leaves nothing to use — and the pattern below on the same page
 * leads to the password, not to the session.
 */
export function LockScreen({ onUnlocked, onUsePassword, auto }: Props) {
  if (lockedBackend() === 'faceid') {
    return <FaceIdGate onUnlocked={onUnlocked} onUsePassword={onUsePassword} auto={auto} size={148} />;
  }
  return <PlatformGate onUnlocked={onUnlocked} onUsePassword={onUsePassword} auto={auto} />;
}

/**
 * Windows Hello / Touch ID, through WebAuthn.
 *
 * The automatic attempt is made quietly. Chrome refuses
 * `navigator.credentials.get()` without user activation often enough that
 * treating a failed auto-attempt as a wrong face would paint a spurious red
 * accusation on first paint, so only a tapped attempt is allowed to fail out
 * loud.
 */
function PlatformGate({ onUnlocked, onUsePassword, auto }: Props) {
  const { t } = usePrefs();
  const [state, setState] = useState<ScanState>('idle');

  const caption =
    state === 'scanning'
      ? t('faceLookAtCamera')
      : state === 'failed'
        ? t('faceNotRecognised')
        : state === 'success'
          ? t('faceUnlocked')
          : t('faceTapToUnlock');

  const run = useCallback(
    async (quiet = false) => {
      if (state === 'scanning' || state === 'success') return;
      setState('scanning');

      const tokens = await unlock();

      if (!tokens) {
        if (quiet) {
          // Almost certainly the missing user gesture, not the wrong face.
          setState('idle');
          return;
        }
        haptics.failed();
        setState('failed');
        return;
      }

      // Before the session lands, not after: the auth change can reach the root
      // gate mid-await, and a face that has just been accepted must not be met
      // with a demand for the pattern.
      markScreenUnlocked();

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
    },
    [state, onUnlocked, onUsePassword]
  );

  const attempted = useRef(false);
  useEffect(() => {
    if (!auto || attempted.current) return;
    attempted.current = true;
    void run(true);
  }, [auto, run]);

  return (
    <GateLayout
      visual={<FaceScan state={state} />}
      title={t('faceUnlock')}
      caption={caption}
      failed={state === 'failed'}
      actionLabel={state === 'failed' ? t('faceTryAgain') : t('faceUnlockAction')}
      onAction={() => void run()}
      busy={state === 'scanning'}
      disabled={state === 'success'}
    />
  );
}
