/**
 * The webcam, for the browser build.
 *
 * Frames are mirrored on capture, not just in the preview. The preview is
 * mirrored because an un-mirrored one feels wrong to look at — everyone expects
 * a mirror — but if only the preview were flipped, the owner would turn one way
 * and the service would see the other. Mirroring at the source keeps "turn
 * left" meaning the same thing to the person and to the face service.
 */

export type CameraFault = 'noApi' | 'insecure' | 'denied' | 'noCamera' | 'failed';

export class CameraFailure extends Error {
  constructor(public readonly fault: CameraFault) {
    super(fault);
  }
}

export interface CameraHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

export interface BurstPlan {
  frames: number;
  intervalMs: number;
}

/** Wide enough for the detector, small enough that a burst posts quickly. */
const CAPTURE_WIDTH = 640;
const JPEG_QUALITY = 0.86;

export function cameraFault(): CameraFault | null {
  if (typeof window === 'undefined') return 'noApi';
  // getUserMedia is only exposed in a secure context, so a plain-http LAN
  // address reports as a missing API rather than as a refusal.
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'noApi';
  return null;
}

export async function openCamera(): Promise<CameraHandle> {
  const fault = cameraFault();
  if (fault) throw new CameraFailure(fault);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
  } catch (error) {
    throw new CameraFailure(faultFor(error));
  }

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true; // iOS Safari otherwise takes the video fullscreen
  video.srcObject = stream;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.style.transform = 'scaleX(-1)';

  const stop = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  try {
    await video.play();
    await firstFrame(video);
  } catch {
    stop();
    throw new CameraFailure('failed');
  }

  return { video, stop };
}

/**
 * A burst of stills, evenly spaced.
 *
 * `onFrame` fires before each capture so the caller can change the instruction
 * mid-burst — the whole liveness check depends on the first frames being taken
 * while the owner is still facing the camera.
 */
export async function captureBurst(
  handle: CameraHandle,
  plan: BurstPlan,
  onFrame?: (index: number) => void
): Promise<string[]> {
  const canvas = document.createElement('canvas');
  const frames: string[] = [];

  for (let index = 0; index < plan.frames; index++) {
    onFrame?.(index);
    frames.push(grab(handle.video, canvas));
    if (index < plan.frames - 1) await wait(plan.intervalMs);
  }
  return frames;
}

/** One still, as a data URL, mirrored and scaled down. */
function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement): string {
  const surface = canvas;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  const scale = Math.min(1, CAPTURE_WIDTH / width);

  surface.width = Math.round(width * scale);
  surface.height = Math.round(height * scale);

  const ctx = surface.getContext('2d');
  if (!ctx) return '';
  ctx.translate(surface.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, surface.width, surface.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return surface.toDataURL('image/jpeg', JPEG_QUALITY);
}

// --- plumbing ----------------------------------------------------------------

function faultFor(error: unknown): CameraFault {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
  return 'failed';
}

/**
 * Resolves once the stream has real dimensions. Grabbing before that produces
 * a 0x0 canvas, which reaches the service as an undecodable frame.
 */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('camera timeout')), 5000);
    video.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
