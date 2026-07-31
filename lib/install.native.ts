/**
 * The native half of `install.web.ts`.
 *
 * A phone build is already installed — it arrived from a store or a build on
 * the device — so there is nothing here to offer, and the settings row that
 * asks hides itself on `'native'`. Structurally identical to the web module on
 * purpose: TypeScript resolves whichever matches the platform (see
 * `moduleSuffixes` in tsconfig), so the two must agree without either importing
 * the other.
 */

export type InstallState = 'native' | 'installed' | 'ready' | 'manual' | 'unsupported';

export type InstallResult = 'installed' | 'dismissed' | 'unavailable';

export function isInstalled(): boolean {
  return true;
}

export function installState(): InstallState {
  return 'native';
}

export function subscribe(_listener: () => void): () => void {
  return () => undefined;
}

export async function promptInstall(): Promise<InstallResult> {
  return 'unavailable';
}
