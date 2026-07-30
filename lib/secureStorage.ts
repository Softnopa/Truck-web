import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Where the Supabase session lives on the device.
 *
 * AsyncStorage keeps its contents in plain text — on a rooted, jailbroken or
 * simply unlocked-and-borrowed phone, the access and refresh tokens can be read
 * straight off disk, and a refresh token is a standing key to the account. This
 * routes them through the platform keystore instead (Keychain on iOS, Keystore
 * on Android), which is hardware-backed on modern devices.
 *
 * SecureStore rejects values much over 2 KB and a Supabase session is larger, so
 * values are split across numbered chunks with a small index entry recording how
 * many there are.
 *
 * The browser has no keystore, so web falls through to AsyncStorage unchanged —
 * that build is for development, not for handling real sessions.
 */

const CHUNK = 1800;
const useSecure = Platform.OS !== 'web';

/**
 * With face unlock armed, the session must never reach durable storage in the
 * clear — the encrypted vault in faceLock is the only copy allowed to outlive
 * the browser. But demanding a face scan on every reload is unusable, so the
 * unlocked session goes to `sessionStorage` instead of `localStorage`:
 * per-tab, wiped when the tab closes.
 *
 * The practical effect: reload, navigate, switch apps and come back — no new
 * prompt. Close the tab or quit the browser and the plaintext is gone, leaving
 * only the ciphertext, so the next launch asks for a face. Nothing plaintext
 * survives a browser restart either way; the exposure is the same as the tab
 * simply being open.
 */
let ephemeral = false;

export function setEphemeralSession(on: boolean): void {
  ephemeral = on;
}

const tabStore = (): Storage | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const countKey = (key: string) => `${key}__n`;
const partKey = (key: string, i: number) => `${key}__${i}`;

async function clearChunks(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const n = raw ? Number(raw) : 0;
  if (!Number.isFinite(n) || n <= 0) return;
  for (let i = 0; i < n; i++) {
    await SecureStore.deleteItemAsync(partKey(key, i));
  }
  await SecureStore.deleteItemAsync(countKey(key));
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (ephemeral) {
      const held = tabStore()?.getItem(key);
      // Falls through when absent: a fresh tab has nothing, which is exactly
      // what makes the lock screen appear.
      if (held != null) return held;
      return null;
    }
    if (!useSecure) return AsyncStorage.getItem(key);
    try {
      const raw = await SecureStore.getItemAsync(countKey(key));
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;

      let out = '';
      for (let i = 0; i < n; i++) {
        const part = await SecureStore.getItemAsync(partKey(key, i));
        // A missing chunk means a torn write: treat the whole session as absent
        // rather than handing back a truncated token that fails in confusing ways.
        if (part === null) return null;
        out += part;
      }
      return out;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (ephemeral) {
      tabStore()?.setItem(key, value);
      return;
    }
    if (!useSecure) return AsyncStorage.setItem(key, value);
    try {
      await clearChunks(key);
      const parts = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < parts; i++) {
        await SecureStore.setItemAsync(partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await SecureStore.setItemAsync(countKey(key), String(parts));
    } catch {
      // Never leave a half-written session behind for the next read to trip on.
      await clearChunks(key).catch(() => undefined);
    }
  },

  async removeItem(key: string): Promise<void> {
    // Cleared unconditionally: signing out must not leave a copy behind in the
    // tab store just because face unlock happened to be off at the time.
    tabStore()?.removeItem(key);
    if (!useSecure) return AsyncStorage.removeItem(key);
    try {
      await clearChunks(key);
    } catch {
      // Signing out must succeed even if the keystore refuses the delete.
    }
  },
};
