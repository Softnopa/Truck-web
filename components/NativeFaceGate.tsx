import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceScan, type ScanState } from '@/components/FaceScan';
import { GateLayout } from '@/components/GateLayout';
import type { StringKey } from '@/i18n/strings';
import { authenticate, checkSupport, type NativeFailure, type NativeSupport } from '@/lib/faceNative';
import { haptics } from '@/lib/haptics';
import { markScreenUnlocked } from '@/lib/screenLock';
import { usePrefs } from '@/providers/PreferencesProvider';

interface Props {
  /** Called once the OS says yes, so the lock can stand down. */
  onUnlocked: () => void;
  /** Runs the prompt as soon as the block appears, without waiting for a tap. */
  auto?: boolean;
  size?: number;
}

/** What each refusal should say out loud. */
const REASON: Record<NativeFailure, StringKey> = {
  cancelled: 'faceNativeCancelled',
  notEnrolled: 'faceNativeNotEnrolled',
  lockedOut: 'faceNativeLockedOut',
  notRecognised: 'faceNotRecognised',
  failed: 'faceIdFailed',
};

/** The prompt title, in the words of whatever the device actually has. */
const TITLE: Record<'face' | 'fingerprint' | 'iris' | 'passcode', StringKey> = {
  face: 'faceNativeFace',
  fingerprint: 'faceNativeFingerprint',
  iris: 'faceNativeIris',
  passcode: 'faceNativePasscode',
};

/**
 * Whether this device has a lock of its own to offer, for the screens that need
 * to know before rendering — a separator above a block that turns out to be
 * empty is worse than no separator at all. `null` while still deciding.
 */
export function useNativeLock(): NativeSupport | null {
  const [support, setSupport] = useState<NativeSupport | null>(null);

  useEffect(() => {
    let alive = true;
    void checkSupport().then((next) => {
      if (alive) setSupport(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return support;
}

/**
 * Face ID on the phone, standing over the app on every launch.
 *
 * It renders nothing where the device has no lock of its own to offer — an
 * iPhone with Face ID turned off in Settings is not a bug to report, it just
 * means the pattern below is the only gate. Passing this check settles the
 * whole run, exactly as the pattern does; failing it changes nothing, because
 * the pattern is still there underneath.
 *
 * Always on by design: there is no enrolment to arm and nothing to seal, so
 * there is no state a toggle could hold. See lib/faceNative.ts.
 */
export function NativeFaceGate({ onUnlocked, auto, size }: Props) {
  const { t } = usePrefs();
  const support = useNativeLock();
  const [state, setState] = useState<ScanState>('idle');
  const [caption, setCaption] = useState('');

  const run = useCallback(async () => {
    if (!support?.ok || state === 'scanning' || state === 'success') return;

    setState('scanning');
    setCaption(t('faceNativePrompt'));

    const result = await authenticate(t(TITLE[support.kind]), t('cancel'));

    if (!result.ok) {
      // Cancelling is a choice, not a failure: the owner has decided to draw
      // the pattern instead, and painting a red refusal over that is a lie.
      if (result.reason === 'cancelled') {
        setState('idle');
        setCaption('');
        return;
      }
      haptics.failed();
      setState('failed');
      setCaption(t(REASON[result.reason]));
      return;
    }

    // Settled for the whole run, wherever it was proved: signing in straight
    // afterwards must not put a second lock on screen.
    markScreenUnlocked();
    haptics.saved();
    setState('success');
    setCaption(t('faceUnlocked'));
    onUnlocked();
  }, [support, state, t, onUnlocked]);

  // One automatic attempt per mount. iOS refuses a second prompt while the
  // first is still up, so a retry loop here would only ever cancel itself.
  const attempted = useRef(false);
  useEffect(() => {
    if (!auto || attempted.current || !support?.ok) return;
    attempted.current = true;
    void run();
  }, [auto, support, run]);

  // Still deciding, or nothing on this device to ask: the pattern stands alone.
  if (!support?.ok) return null;

  return (
    <GateLayout
      visual={<FaceScan state={state} size={size} />}
      title={t(TITLE[support.kind])}
      caption={caption || t('faceTapToUnlock')}
      failed={state === 'failed'}
      actionLabel={state === 'failed' ? t('faceTryAgain') : t('faceUnlockAction')}
      onAction={() => void run()}
      busy={state === 'scanning'}
      disabled={state === 'success'}
    />
  );
}
