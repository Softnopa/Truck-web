/**
 * No webcam capture on native.
 *
 * iOS and Android already have a hardware-backed face check — Face ID, Touch ID,
 * the Android keystore — reachable through expo-local-authentication, and the
 * session already sits in the platform keystore (see secureStorage). Pointing a
 * camera at the problem there would be a downgrade, so every entry point in the
 * web module has a refusing counterpart here rather than a partial one.
 */

export type CameraFault = 'noApi' | 'insecure' | 'denied' | 'noCamera' | 'failed';

export class CameraFailure extends Error {
  constructor(public readonly fault: CameraFault) {
    super(fault);
  }
}

/**
 * Structurally identical to the web handle on purpose. TypeScript resolves this
 * module first (moduleSuffixes puts `.native` ahead of `.web`), so a narrower
 * shape here would fail the web-only components that consume it — even though
 * `openCamera` below never returns one.
 */
export interface CameraHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

export interface BurstPlan {
  frames: number;
  intervalMs: number;
}

export function cameraFault(): CameraFault | null {
  return 'noApi';
}

export async function openCamera(): Promise<CameraHandle> {
  throw new CameraFailure('noApi');
}

export async function captureBurst(
  _handle: CameraHandle,
  _plan: BurstPlan,
  _onFrame?: (index: number) => void
): Promise<string[]> {
  return [];
}
