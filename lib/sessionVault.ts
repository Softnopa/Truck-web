import { Platform } from 'react-native';

/**
 * The sealed Supabase session, and the small amount of crypto around it.
 *
 * Two different things can prove a face — the platform authenticator behind
 * WebAuthn (`faceLock`) and the local Python service (`faceId`) — but what they
 * do afterwards is identical: turn 32 bytes released by that proof into an AES
 * key, and use it to encrypt the refresh token sitting in localStorage.
 *
 * That encryption is the entire point. A face check that only hides the UI is a
 * curtain; anyone with the browser profile reads the token straight off disk.
 * With the vault, the token is ciphertext and the key does not exist anywhere
 * until a face releases it.
 */

export const isWeb = Platform.OS === 'web';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

export interface Vault {
  iv: string;
  ciphertext: string;
}

// --- encoding ---------------------------------------------------------------

export function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Backed by an explicit ArrayBuffer rather than `new Uint8Array(n)`: the WebAuthn
 * and SubtleCrypto signatures want `BufferSource`, which since TS 5.7 excludes a
 * view whose buffer might be a SharedArrayBuffer.
 */
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- crypto -----------------------------------------------------------------

/** Whatever released the secret, it becomes the AES key the same way. */
export function keyFromSecret(secret: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, tokens: SessionTokens): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(tokens));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toB64(iv.buffer), ciphertext: toB64(ct) };
}

export async function unseal(key: CryptoKey, vault: Vault): Promise<SessionTokens | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(vault.iv) },
      key,
      fromB64(vault.ciphertext)
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as SessionTokens;
    return parsed?.refresh_token ? parsed : null;
  } catch {
    // Wrong key or tampered ciphertext — deliberately indistinguishable.
    return null;
  }
}

// --- persisted enrolment ----------------------------------------------------

export function readStore<T>(storeKey: string): T | null {
  if (!isWeb) return null;
  try {
    const raw = window.localStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStore(storeKey: string, value: unknown | null): void {
  if (!isWeb) return;
  try {
    if (value) window.localStorage.setItem(storeKey, JSON.stringify(value));
    else window.localStorage.removeItem(storeKey);
  } catch {
    // A full or blocked localStorage must not break signing in.
  }
}
