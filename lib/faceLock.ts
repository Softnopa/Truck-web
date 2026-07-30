import { Platform } from 'react-native';
import { setEphemeralSession } from './secureStorage';

/**
 * Face unlock for the browser build, via WebAuthn.
 *
 * Why WebAuthn rather than matching faces in JavaScript: a face-matching
 * library (face-api.js and friends) compares a webcam frame against a stored
 * descriptor, which means a photograph of the owner held up to the camera
 * passes, and the ~7 MB of model weights buy nothing but a curtain over the UI.
 * The platform authenticator behind WebAuthn — Windows Hello, Touch ID — uses
 * an infrared depth camera, is hardware-backed, and never lets this app near
 * the biometric itself. It answers one question: is this the enrolled human.
 *
 * What makes this a real lock rather than a hidden screen: the PRF extension.
 * PRF returns a stable 32-byte secret derived from the credential, but only
 * after a successful biometric check. That secret is the AES key for the
 * Supabase session, so with face unlock on, the refresh token sits in
 * localStorage as ciphertext. Someone holding the browser profile, or poking at
 * devtools, has nothing usable without the owner's face.
 *
 * Not every browser exposes PRF yet. Where it is missing this degrades to a
 * presence check — still a biometric gate, but the session stays readable, so
 * `encrypted` is reported honestly and the settings row says as much.
 *
 * Native builds have the OS keystore already (see secureStorage) and should use
 * expo-local-authentication instead; every entry point here no-ops off web.
 */

const STORE_KEY = 'truck.facelock.v1';
const PRF_SALT = new TextEncoder().encode('truck-app/face-unlock/v1');
const RP_NAME = 'Truck';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

interface Vault {
  iv: string;
  ciphertext: string;
}

interface Enrollment {
  credentialId: string;
  userId: string;
  vault: Vault;
}

const isWeb = Platform.OS === 'web';

/**
 * The PRF-derived AES key, held only while the app is open and unlocked.
 *
 * Supabase rotates the refresh token roughly hourly, which would leave the
 * vault holding a dead token and strand the owner at the lock screen. Caching
 * the key lets `reseal` re-encrypt silently on every rotation instead of
 * demanding a face scan each time. It never touches disk.
 */
let liveKey: CryptoKey | null = null;

// --- encoding ---------------------------------------------------------------

function toB64(buf: ArrayBuffer): string {
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
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- persisted enrolment ----------------------------------------------------

function read(): Enrollment | null {
  if (!isWeb) return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Enrollment;
    return typeof parsed?.credentialId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function write(value: Enrollment | null): void {
  if (!isWeb) return;
  try {
    if (value) window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    // A full or blocked localStorage must not break signing in.
  }
}

// --- capability -------------------------------------------------------------

/**
 * Why the feature is or is not available here. Reported rather than reduced to
 * a boolean so the settings row can say what is wrong instead of silently
 * disappearing, which is exactly how it went missing on iPhone.
 */
export type Support =
  | { ok: true }
  | { ok: false; reason: 'native' | 'noApi' | 'insecure' | 'noAuthenticator' };

export async function checkSupport(): Promise<Support> {
  if (!isWeb) return { ok: false, reason: 'native' };
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { ok: false, reason: 'noApi' };
  }
  // WebAuthn requires a secure context; Vercel serves https, localhost counts.
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  try {
    const available =
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    // iOS reports false until the device itself has Face ID, Touch ID or at
    // least a passcode configured — there is no authenticator to borrow.
    return available ? { ok: true } : { ok: false, reason: 'noAuthenticator' };
  } catch {
    return { ok: false, reason: 'noApi' };
  }
}

/** Whether this browser holds an enrolment for the given owner. */
export function isEnrolled(userId: string | null): boolean {
  const saved = read();
  return Boolean(saved && userId && saved.userId === userId);
}

/** True when a sealed session is waiting, i.e. the app must show the gate. */
export function hasLockedSession(): boolean {
  return Boolean(read()?.vault);
}

// --- crypto -----------------------------------------------------------------

function keyFromPrf(secret: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(key: CryptoKey, tokens: SessionTokens): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(tokens));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toB64(iv.buffer), ciphertext: toB64(ct) };
}

async function unseal(key: CryptoKey, vault: Vault): Promise<SessionTokens | null> {
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

/** PRF lives outside the DOM typings, so it is read through a narrow shape. */
function prfSecret(credential: PublicKeyCredential): ArrayBuffer | null {
  const ext = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } };
  };
  const first = ext.prf?.results?.first;
  if (!first) return null;
  if (first instanceof ArrayBuffer) return first;
  return new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice().buffer;
}

const prfExtension = { prf: { eval: { first: PRF_SALT } } } as unknown as
  AuthenticationExtensionsClientInputs;

// --- enrol / unlock ---------------------------------------------------------

export type EnableResult =
  | { ok: true }
  /**
   * `noPrf` means the authenticator works but will not derive a secret, so the
   * session could not be encrypted. Enrolling anyway would give a toggle that
   * reads "on" while protecting nothing, so this refuses instead.
   */
  | { ok: false; reason: 'cancelled' | 'noPrf' };

/**
 * Registers this device's authenticator against the signed-in owner and, where
 * PRF allows, seals the session so the app can no longer start without a face
 * check. Only ever called while genuinely signed in — the password step is what
 * establishes *which* owner this is, which is the part a face cannot prove
 * safely in a browser.
 */
export async function enable(
  userId: string,
  userName: string,
  tokens: SessionTokens
): Promise<EnableResult> {
  if (!isWeb) return { ok: false, reason: 'cancelled' };

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME, id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName || userId,
        displayName: userName || userId,
      },
      // ES256 then RS256: the two every platform authenticator implements.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      extensions: prfExtension,
    },
  })) as PublicKeyCredential | null;

  if (!credential) return { ok: false, reason: 'cancelled' };
  const credentialId = toB64(credential.rawId);

  // Chrome does not hand back a PRF result on create() for every authenticator,
  // so the secret comes from an immediate get(). The extra prompt doubles as a
  // rehearsal: the owner sees exactly what unlocking will look like.
  const secret = await prfFromAssertion(credentialId);
  if (!secret) return { ok: false, reason: 'noPrf' };

  liveKey = await keyFromPrf(secret);
  write({ credentialId, userId, vault: await seal(liveKey, tokens) });

  // From here the vault is the only copy that outlives the browser. Route the
  // live session to per-tab storage so reloads stay quiet without ever writing
  // the token somewhere a closed browser would still hold it.
  setEphemeralSession(true);
  return { ok: true };
}

async function prfFromAssertion(credentialId: string): Promise<ArrayBuffer | null> {
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: prfExtension,
      },
    })) as PublicKeyCredential | null;
    return assertion ? prfSecret(assertion) : null;
  } catch {
    return null;
  }
}

/**
 * Runs the biometric check and decrypts the session. Returns null on any
 * failure — cancelled prompt, wrong face, tampered vault — deliberately
 * without distinguishing them.
 */
export async function unlock(): Promise<SessionTokens | null> {
  if (!isWeb) return null;
  const saved = read();
  if (!saved) return null;

  const secret = await prfFromAssertion(saved.credentialId);
  if (!secret) return null;

  const key = await keyFromPrf(secret);
  const tokens = await unseal(key, saved.vault);
  if (!tokens) return null;

  liveKey = key;
  return tokens;
}

/**
 * Re-seals after Supabase rotates the refresh token. Uses the key cached at
 * unlock, so it is silent — no second face prompt an hour into the shift. A
 * no-op when face unlock is off, unencrypted, or the key is not in memory.
 */
export async function reseal(tokens: SessionTokens): Promise<void> {
  const saved = read();
  if (!saved || !liveKey) return;
  write({ ...saved, vault: await seal(liveKey, tokens) });
}

/** Forgets the enrolment. The authenticator credential itself is left alone. */
export function disable(): void {
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
