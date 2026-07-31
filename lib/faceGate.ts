import * as faceId from './faceId';
import * as faceLock from './faceLock';
import type { SessionTokens } from './sessionVault';

/**
 * Two ways to unlock with a face, one gate.
 *
 * `faceLock` is the platform authenticator — Windows Hello, Touch ID — reached
 * through WebAuthn. `faceId` is our own service: a webcam, and face matching
 * computed in Python on the owner's machine. Only one can be armed at a time,
 * because both seal the same session and a second enrolment would overwrite the
 * vault the first one is waiting on.
 *
 * Everything outside the two settings rows should come through here rather than
 * importing a backend directly, so startup, sign-out and token rotation stay
 * blind to which one happens to be on.
 */

export type Backend = 'webauthn' | 'faceid';

export type { SessionTokens };

/** Which backend is holding a sealed session, if any. */
export function lockedBackend(): Backend | null {
  if (faceId.hasLockedSession()) return 'faceid';
  if (faceLock.hasLockedSession()) return 'webauthn';
  return null;
}

export function hasLockedSession(): boolean {
  return lockedBackend() !== null;
}

/** Which backend this browser is enrolled with for the given owner. */
export function enrolledBackend(userId: string | null): Backend | null {
  if (faceId.isEnrolled(userId)) return 'faceid';
  if (faceLock.isEnrolled(userId)) return 'webauthn';
  return null;
}

/**
 * Runs before the Supabase client touches storage. Either vault means the same
 * thing: no plaintext session may reach durable storage in this tab.
 */
export function armPersistenceGuard(): void {
  faceLock.armPersistenceGuard();
  faceId.armPersistenceGuard();
}

/** Follows Supabase's hourly token rotation. A no-op for whichever is not armed. */
export async function reseal(tokens: SessionTokens): Promise<void> {
  await Promise.all([faceLock.reseal(tokens), faceId.reseal(tokens)]);
}

/**
 * Drops both vaults without touching the enrolled faces.
 *
 * Called when the sealed refresh token stops being usable — signing out revokes
 * it, and a vault holding a revoked token can only ever fail. The face id itself
 * stays in the service's folder, so re-arming later is one capture rather than a
 * fresh enrolment. Turning the setting off is the separate, deliberate act that
 * deletes it (see `faceId.disable`).
 */
export function clearVaults(): void {
  faceLock.disable();
  faceId.forgetLocally();
}
