import { useCallback, useRef, useState } from 'react';
import { FaceCamera, type FaceCameraHandle } from '@/components/FaceCamera';
import { type ScanState } from '@/components/FaceScan';
import { GateLayout } from '@/components/GateLayout';
import { beginUnlock, finishUnlock, forgetLocally, type FaceIdReason } from '@/lib/faceId';
import { haptics } from '@/lib/haptics';
import { markScreenUnlocked } from '@/lib/screenLock';
import { supabase } from '@/lib/supabase';
import { usePrefs } from '@/providers/PreferencesProvider';
import type { StringKey } from '@/i18n/strings';

interface Props {
  onUnlocked: () => void;
  onUsePassword: () => void;
  /** Starts the burst as soon as the camera is live, without waiting for a tap. */
  auto?: boolean;
  size?: number;
}

/** What each refusal from the service should say out loud. */
export const REASON_STRING: Record<FaceIdReason, StringKey> = {
  offline: 'faceIdOffline',
  not_enrolled: 'faceIdNotEnrolled',
  too_many_attempts: 'faceIdLockedOut',
  no_face: 'faceIdNoFace',
  too_far: 'faceIdTooFar',
  two_faces: 'faceIdTwoFaces',
  not_centred: 'faceIdNotCentred',
  no_turn: 'faceIdNoTurn',
  wrong_turn: 'faceIdWrongTurn',
  no_match: 'faceNotRecognised',
  inconsistent: 'faceIdInconsistent',
  expired: 'faceIdExpired',
  failed: 'faceIdFailed',
};

/**
 * The camera gate: our own face service decides, and only then is there a key.
 *
 * The instruction changes partway through the burst on purpose. The service
 * needs frames of the owner facing the camera *before* the ones where they have
 * turned — that ordering is what separates a head that moved from a photograph
 * that was already held at an angle.
 */
export function FaceIdGate({ onUnlocked, onUsePassword, auto, size }: Props) {
  const { t } = usePrefs();
  const camera = useRef<FaceCameraHandle>(null);
  const [state, setState] = useState<ScanState>('idle');
  const [caption, setCaption] = useState<string>(t('faceTapToUnlock'));

  const fail = useCallback(
    (message: string) => {
      haptics.failed();
      setState('failed');
      setCaption(message);
    },
    []
  );

  const run = useCallback(async () => {
    if (state === 'scanning' || state === 'success') return;
    setState('scanning');
    setCaption(t('faceLookAtCamera'));

    const started = await beginUnlock();
    if (!started.ok) {
      fail(t(REASON_STRING[started.reason]));
      return;
    }

    const { token, action, frames, intervalMs } = started.challenge;
    // A third of the burst facing the camera, the rest turning. Enough centred
    // frames to be sure of the identity, enough turned ones to allow for the
    // moment it takes to react to the instruction.
    const turnAt = Math.max(4, Math.round(frames * 0.35));

    const shots = await camera.current?.capture({ frames, intervalMs }, (index) => {
      if (index === turnAt) {
        haptics.tap();
        setCaption(t(action === 'left' ? 'faceIdTurnLeft' : 'faceIdTurnRight'));
      }
    });

    if (!shots || shots.length === 0) {
      fail(t('faceIdNoCamera'));
      return;
    }

    setCaption(t('faceIdChecking'));
    const result = await finishUnlock(token, shots);
    if (!result.ok) {
      fail(t(REASON_STRING[result.reason]));
      return;
    }

    // Before the session lands, not after: the auth change can reach the root
    // gate mid-await, and a face that has just been accepted must not be met
    // with a demand for the pattern.
    markScreenUnlocked();

    const { error } = await supabase.auth.setSession(result.tokens);
    if (error) {
      // The sealed refresh token no longer works — revoked, or expired while the
      // app sat unopened. Nothing here can recover it, so drop the vault and
      // fall back to the password rather than loop forever. The enrolled face
      // stays; only this browser's sealed copy is gone.
      forgetLocally();
      fail(t('faceIdStale'));
      onUsePassword();
      return;
    }

    haptics.saved();
    setState('success');
    setCaption(t('faceUnlocked'));
    onUnlocked();
  }, [state, t, fail, onUnlocked, onUsePassword]);

  // The burst waits for a live stream. Firing on mount instead would capture
  // against a camera that has not opened yet and report "no camera" for what is
  // only the second it takes to acquire the device.
  const started = useRef(false);
  const ready = useCallback(() => {
    if (!auto || started.current) return;
    started.current = true;
    void run();
  }, [auto, run]);

  return (
    <GateLayout
      visual={
        <FaceCamera
          ref={camera}
          active
          state={state}
          size={size}
          onReady={ready}
          onFault={(fault) =>
            fail(t(fault === 'denied' ? 'faceIdCameraDenied' : 'faceIdNoCamera'))
          }
        />
      }
      title={t('faceId')}
      caption={caption}
      failed={state === 'failed'}
      actionLabel={state === 'failed' ? t('faceTryAgain') : t('faceUnlockAction')}
      onAction={() => void run()}
      busy={state === 'scanning'}
      disabled={state === 'success'}
    />
  );
}
