import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

/**
 * Face ID on the phone, through the OS.
 *
 * The two web backends do not exist here and never could: `faceLock` needs
 * WebAuthn and `faceId` needs a Python service on a desktop, so both answered
 * `reason: 'native'` and both settings rows rendered `null`. The practical
 * effect was that an iPhone had no face check at all — the feature the app
 * advertises simply was not there.
 *
 * This is the honest iOS answer, and it is the strong one: Face ID and Touch ID
 * are the platform's own, backed by the Secure Enclave, and the app never sees
 * the biometric. There is nothing to enrol here and no vault to seal, because
 * the session is already in the Keychain (see secureStorage) rather than in
 * readable storage the way a browser's is — so what a face buys on the phone is
 * a screen lock in front of the app, exactly like the pattern beside it.
 *
 * It is therefore always on. There is no toggle: where the device has a face,
 * a fingerprint or even just a passcode, the app asks for it on every launch.
 */

export type NativeLockKind = 'face' | 'fingerprint' | 'iris' | 'passcode';

export type NativeSupport =
  | { ok: true; kind: NativeLockKind }
  /**
   * `noHardware` is a device with no biometric at all; `notEnrolled` is one
   * where nothing has been set up, not even a passcode. Both leave the pattern
   * as the only lock, which is why neither is an error.
   */
  | { ok: false; reason: 'web' | 'noHardware' | 'notEnrolled' };

export type NativeFailure =
  | 'cancelled'
  | 'notEnrolled'
  | 'lockedOut'
  | 'notRecognised'
  | 'failed';

const isNative = Platform.OS !== 'web';

/**
 * Which check this device will actually run, so the gate can name it. iOS
 * reports facial recognition on a Face ID phone and fingerprint on a Touch ID
 * one; Android reports whatever the sensor is.
 */
export async function checkSupport(): Promise<NativeSupport> {
  if (!isNative) return { ok: false, reason: 'web' };

  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    if (!enrolled) {
      // No biometric enrolled, but a device passcode still counts: the OS
      // prompt falls back to it, which is a lock worth having.
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.SECRET) {
        return { ok: true, kind: 'passcode' };
      }
      return { ok: false, reason: hardware ? 'notEnrolled' : 'noHardware' };
    }

    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return { ok: true, kind: 'face' };
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return { ok: true, kind: 'iris' };
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return { ok: true, kind: 'fingerprint' };
    }
    return { ok: true, kind: 'passcode' };
  } catch {
    // A module that will not answer must not take the lock screen down with it.
    return { ok: false, reason: 'noHardware' };
  }
}

export type NativeResult = { ok: true } | { ok: false; reason: NativeFailure };

/**
 * Runs the OS prompt. `disableDeviceFallback` is deliberately left off, so a
 * face that will not read drops to the device passcode inside the same prompt
 * rather than dead-ending — the pattern underneath is the app's own fallback,
 * not the only one.
 */
export async function authenticate(prompt: string, cancelLabel: string): Promise<NativeResult> {
  if (!isNative) return { ok: false, reason: 'failed' };

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel,
      // iOS only, and only meaningful for Face ID: without it a successful scan
      // needs a second tap to confirm, which reads as the check having failed.
      requireConfirmation: false,
    });

    if (result.success) return { ok: true };

    switch (result.error) {
      case 'user_cancel':
      case 'app_cancel':
      case 'system_cancel':
      case 'user_fallback':
        return { ok: false, reason: 'cancelled' };
      case 'not_enrolled':
      case 'passcode_not_set':
        return { ok: false, reason: 'notEnrolled' };
      case 'lockout':
        return { ok: false, reason: 'lockedOut' };
      case 'authentication_failed':
        return { ok: false, reason: 'notRecognised' };
      default:
        return { ok: false, reason: 'failed' };
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
