import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { ScanFrame, type ScanState } from '@/components/FaceScan';
import {
  captureBurst,
  CameraFailure,
  openCamera,
  type BurstPlan,
  type CameraFault,
  type CameraHandle,
} from '@/lib/camera';

export interface FaceCameraHandle {
  /** Captures a burst, or an empty array if the camera never opened. */
  capture: (plan: BurstPlan, onFrame?: (index: number) => void) => Promise<string[]>;
}

interface Props {
  /**
   * The stream is only held while this is true. A camera light that stays on
   * after the sheet closes is alarming, and correctly so.
   */
  active: boolean;
  state: ScanState;
  size?: number;
  onFault?: (fault: CameraFault) => void;
  /** Fires once the stream is live, i.e. `capture` will return real frames. */
  onReady?: () => void;
}

/**
 * A live preview inside the Face ID plate.
 *
 * The `<video>` is created outside React and appended to a plain div: a stream
 * survives a re-render that way, where a `srcObject` set through props gets torn
 * down and reacquired every time the caption changes, and each reacquire is
 * another second of black frames.
 *
 * The callbacks are reached through a ref for the same reason. Callers pass
 * inline arrows, so a caption change gives `onFault` a new identity; as an
 * effect dependency that would stop and reopen the camera on every render,
 * which is exactly the churn the div above exists to avoid.
 */
export const FaceCamera = forwardRef<FaceCameraHandle, Props>(function FaceCamera(
  { active, state, size = 208, onFault, onReady },
  ref
) {
  const mount = useRef<HTMLDivElement | null>(null);
  const camera = useRef<CameraHandle | null>(null);
  const handlers = useRef({ onFault, onReady });
  handlers.current = { onFault, onReady };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void (async () => {
      try {
        const handle = await openCamera();
        // Opening is asynchronous and the sheet can close during it; without
        // this the stream would be left running with nothing showing it.
        if (cancelled) {
          handle.stop();
          return;
        }
        camera.current = handle;
        mount.current?.appendChild(handle.video);
        handlers.current.onReady?.();
      } catch (error) {
        if (!cancelled) {
          handlers.current.onFault?.(error instanceof CameraFailure ? error.fault : 'failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      camera.current?.stop();
      camera.current?.video.remove();
      camera.current = null;
    };
  }, [active]);

  useImperativeHandle(
    ref,
    () => ({
      capture: async (plan, onFrame) => {
        const handle = camera.current;
        if (!handle) return [];
        return captureBurst(handle, plan, onFrame);
      },
    }),
    []
  );

  return (
    <ScanFrame state={state} size={size}>
      <div ref={mount} style={surface} />
    </ScanFrame>
  );
});

/** Plain CSS: this element is a DOM node, not a react-native-web View. */
const surface: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  display: 'flex',
};
