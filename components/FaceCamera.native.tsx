import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { ScanFrame, type ScanState } from '@/components/FaceScan';
import type { BurstPlan, CameraFault } from '@/lib/camera';

export interface FaceCameraHandle {
  capture: (plan: BurstPlan, onFrame?: (index: number) => void) => Promise<string[]>;
}

interface Props {
  active: boolean;
  state: ScanState;
  size?: number;
  onFault?: (fault: CameraFault) => void;
  /** Never fires here: there is no stream to become ready. */
  onReady?: () => void;
}

/**
 * Native has no webcam capture here — see lib/camera.native.ts for why. The
 * plate still renders so a shared screen keeps its shape, and the fault is
 * reported immediately so the caller shows the reason rather than a dead frame.
 */
export const FaceCamera = forwardRef<FaceCameraHandle, Props>(function FaceCamera(
  { active, state, size = 208, onFault },
  ref
) {
  // Held in a ref so an inline arrow from the caller does not re-fire the fault
  // on every render — see the web twin for the whole reason.
  const fault = useRef(onFault);
  fault.current = onFault;

  useEffect(() => {
    if (active) fault.current?.('noApi');
  }, [active]);

  useImperativeHandle(ref, () => ({ capture: async () => [] }), []);

  return <ScanFrame state={state} size={size} />;
});
