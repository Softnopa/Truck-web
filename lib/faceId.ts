import { cameraFault } from './camera';
import { setEphemeralSession } from './secureStorage';
import {
  fromB64,
  isWeb,
  keyFromSecret,
  readStore,
  seal,
  unseal,
  writeStore,
  type SessionTokens,
  type Vault,
} from './sessionVault';

/**
 * Face ID against our own face service, running on the owner's machine.
 *
 * This is the camera route, and it is worth being exact about what it is. The
 * browser sends a short burst of webcam frames to a local Python service; that
 * service finds the face, aligns it, turns it into a 128-number embedding and
 * compares it with the one captured at enrolment. No cloud, no account, no
 * biometric leaving the machine — see face-id/README.md.
 *
 * A webcam is a colour camera, so on its own it cannot tell a face from a
 * photograph of one. Two things answer that. The service names a direction only
 * after the app asks, and the frames have to show a head that starts facing the
 * camera and then turns that way — a still photo cannot answer, and nobody can
 * answer in advance. And the session is encrypted rather than merely hidden:
 * the service holds 32 random bytes per person and releases them only on a
 * match, so with Face ID on, the refresh token in localStorage is ciphertext.
 * Beat the liveness check and you get in; without beating it, there is nothing
 * on disk to take.
 *
 * The service is not always running, and the app must survive that: with the
 * vault sealed and the service down, the honest outcome is the password, which
 * is what `unlock` failing leads to.
 *
 * The other backend, faceLock.ts, uses the platform authenticator (Windows
 * Hello, Face ID on a Mac). Where it is available it is the stronger of the two
 * — depth camera, hardware-backed — and the settings screen offers both.
 */

const STORE_KEY = 'truck.faceid.v1';

/** The service is local by design; the URL is only here for an unusual setup. */
const SERVICE_URL = (process.env.EXPO_PUBLIC_FACEID_URL || 'http://127.0.0.1:8765').replace(
  /\/+$/,
  ''
);

/** A face check is tens of milliseconds of work; anything slower is a dead port. */
const HEALTH_TIMEOUT_MS = 2500;
const CALL_TIMEOUT_MS = 30_000;

export type { SessionTokens };

interface Enrollment {
  personId: string;
  userId: string;
  label: string;
  vault: Vault;
}

/** Whatever went wrong, in the service's own words. See face-id/faceid/liveness.py. */
export type FaceIdReason =
  | 'offline'
  | 'not_enrolled'
  | 'too_many_attempts'
  | 'no_face'
  | 'too_far'
  | 'two_faces'
  | 'not_centred'
  | 'no_turn'
  | 'wrong_turn'
  | 'no_match'
  | 'inconsistent'
  | 'expired'
  | 'failed';

export type TurnAction = 'left' | 'right';

export interface Challenge {
  token: string;
  action: TurnAction;
  frames: number;
  intervalMs: number;
}

/**
 * The AES key, held only while the app is open and unlocked, so `reseal` can
 * follow Supabase's hourly token rotation without a second face scan.
 */
let liveKey: CryptoKey | null = null;

// --- persisted enrolment ----------------------------------------------------

function read(): Enrollment | null {
  const parsed = readStore<Enrollment>(STORE_KEY);
  return typeof parsed?.personId === 'string' ? parsed : null;
}

function write(value: Enrollment | null): void {
  writeStore(STORE_KEY, value);
}

export function isEnrolled(userId: string | null): boolean {
  const saved = read();
  return Boolean(saved && userId && saved.userId === userId);
}

/** True when a sealed session is waiting, i.e. the app must show the gate. */
export function hasLockedSession(): boolean {
  return Boolean(read()?.vault);
}

/** The name shown on the lock screen, so the gate says who it is waiting for. */
export function enrolledLabel(): string {
  return read()?.label ?? '';
}

// --- talking to the service --------------------------------------------------

async function call<T>(path: string, body: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<T | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(`${SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Service down, port closed, blocked by the browser: all the same to the
    // caller, which falls back to the password either way.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- capability -------------------------------------------------------------

export type Support =
  | { ok: true }
  | { ok: false; reason: 'native' | 'insecure' | 'noCamera' | 'offline' };

/**
 * Whether Face ID can be offered here at all, and if not, which of the four
 * conditions is missing — a settings row that vanishes silently reads as a bug.
 */
export async function checkSupport(): Promise<Support> {
  if (!isWeb) return { ok: false, reason: 'native' };

  const fault = cameraFault();
  if (fault === 'insecure') return { ok: false, reason: 'insecure' };
  if (fault) return { ok: false, reason: 'noCamera' };

  return (await isServiceUp()) ? { ok: true } : { ok: false, reason: 'offline' };
}

export async function isServiceUp(): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${SERVICE_URL}/health`, { signal: abort.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- enrol ------------------------------------------------------------------

export type EnrolResult = { ok: true; samples: number } | { ok: false; reason: FaceIdReason };

/**
 * Registers this face with the service and seals the session behind it.
 *
 * Only ever called while genuinely signed in. The password is what establishes
 * *which* owner this is — a face captured on an unauthenticated screen would
 * prove nothing about whose account it should open.
 */
export async function enrol(
  userId: string,
  userName: string,
  tokens: SessionTokens,
  frames: string[]
): Promise<EnrolResult> {
  if (!isWeb) return { ok: false, reason: 'failed' };

  const result = await call<{ ok: boolean; reason?: string; secret?: string; accepted?: number }>(
    '/enroll',
    { personId: userId, label: userName, frames }
  );

  if (!result) return { ok: false, reason: 'offline' };
  if (!result.ok || !result.secret) {
    return { ok: false, reason: (result.reason as FaceIdReason) ?? 'failed' };
  }

  liveKey = await keyFromSecret(fromB64(result.secret).buffer);
  write({
    personId: userId,
    userId,
    label: userName,
    vault: await seal(liveKey, tokens),
  });

  // From here the vault is the only copy that outlives the browser. Route the
  // live session to per-tab storage so reloads stay quiet without ever writing
  // the token somewhere a closed browser would still hold it.
  setEphemeralSession(true);
  return { ok: true, samples: result.accepted ?? frames.length };
}

// --- unlock -----------------------------------------------------------------

export type ChallengeResult = { ok: true; challenge: Challenge } | { ok: false; reason: FaceIdReason };

/**
 * Asks the service which way to turn. Done before capturing rather than after,
 * so the instruction cannot be predicted and a recorded answer is worthless.
 */
export async function beginUnlock(): Promise<ChallengeResult> {
  const saved = read();
  if (!saved) return { ok: false, reason: 'not_enrolled' };

  const result = await call<{
    ok: boolean;
    reason?: string;
    token?: string;
    action?: TurnAction;
    frames?: number;
    intervalMs?: number;
  }>('/challenge', { personId: saved.personId });

  if (!result) return { ok: false, reason: 'offline' };
  if (!result.ok || !result.token || !result.action) {
    return { ok: false, reason: (result.reason as FaceIdReason) ?? 'failed' };
  }

  return {
    ok: true,
    challenge: {
      token: result.token,
      action: result.action,
      frames: result.frames ?? 14,
      intervalMs: result.intervalMs ?? 220,
    },
  };
}

export type UnlockResult =
  | { ok: true; tokens: SessionTokens }
  | { ok: false; reason: FaceIdReason };

/**
 * Sends the burst and, on a match, decrypts the session with the secret the
 * service releases. A wrong face, a photograph or a turn the other way all end
 * here with nothing.
 */
export async function finishUnlock(token: string, frames: string[]): Promise<UnlockResult> {
  const saved = read();
  if (!saved) return { ok: false, reason: 'not_enrolled' };

  const result = await call<{ ok: boolean; reason?: string; secret?: string }>('/verify', {
    token,
    frames,
  });

  if (!result) return { ok: false, reason: 'offline' };
  if (!result.ok || !result.secret) {
    return { ok: false, reason: (result.reason as FaceIdReason) ?? 'failed' };
  }

  const key = await keyFromSecret(fromB64(result.secret).buffer);
  const tokens = await unseal(key, saved.vault);
  // The face matched but the vault will not open: the service was re-enrolled
  // out from under this browser, so its secret no longer fits. Nothing here can
  // recover it, and pretending otherwise loops the owner at the lock screen.
  if (!tokens) return { ok: false, reason: 'no_match' };

  liveKey = key;
  return { ok: true, tokens };
}

// --- lifecycle ---------------------------------------------------------------

/** Re-seals after Supabase rotates the refresh token. Silent, using the live key. */
export async function reseal(tokens: SessionTokens): Promise<void> {
  const saved = read();
  if (!saved || !liveKey) return;
  write({ ...saved, vault: await seal(liveKey, tokens) });
}

/**
 * Forgets the enrolment on this browser and asks the service to delete the face
 * id it holds. The delete is best-effort: with the service down, the vault still
 * has to go, or the next launch waits at a lock nothing can open.
 */
export async function disable(): Promise<void> {
  const saved = read();
  liveKey = null;
  write(null);
  setEphemeralSession(false);
  if (saved) await call('/forget', { personId: saved.personId }, HEALTH_TIMEOUT_MS);
}

/** Synchronous half of `disable`, for the paths that cannot await. */
export function forgetLocally(): void {
  liveKey = null;
  write(null);
  setEphemeralSession(false);
}

/**
 * Called once at startup, before the Supabase client reads its storage: with a
 * vault waiting, the session belongs in per-tab storage for the whole life of
 * the tab, including after an unlock re-establishes it.
 */
export function armPersistenceGuard(): void {
  if (hasLockedSession()) setEphemeralSession(true);
}
