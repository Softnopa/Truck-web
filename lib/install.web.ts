/**
 * Installing the web app onto a desktop or a home screen.
 *
 * A browser decides for itself when a site may be installed, and it announces
 * that by firing `beforeinstallprompt` — once, early, usually before React has
 * mounted anything. The event has to be caught at module scope and held, or the
 * offer is gone by the time a settings screen exists to show a button. Calling
 * `preventDefault` on it is what stops Chrome putting up its own mini-infobar,
 * which is the trade for being allowed to prompt later from a real button.
 *
 * Only Chromium browsers implement it. Safari can still install — through
 * Share → Add to Home Screen — but offers no API to trigger it, so the honest
 * thing there is to say where the menu item is rather than show a dead button.
 */

type Outcome = 'accepted' | 'dismissed';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: Outcome }>;
}

export type InstallState =
  /** Not the web build — the row does not belong on a phone app. */
  | 'native'
  /** Already running as an installed app. */
  | 'installed'
  /** The browser has offered; the button will work. */
  | 'ready'
  /** Installable by hand only — iOS, essentially. */
  | 'manual'
  /** Web, but this browser will not offer it. */
  | 'unsupported';

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    announce();
  });

  // Fired whether the install came from our button or the browser's own menu.
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });
}

/** True when the app is running in its own window rather than a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS predates the media query and answers on the navigator instead.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return Boolean(standalone || iosStandalone);
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, and is told apart by the touch points.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

export function installState(): InstallState {
  if (typeof window === 'undefined') return 'unsupported';
  if (isInstalled()) return 'installed';
  if (deferred) return 'ready';
  if (isApple()) return 'manual';
  return 'unsupported';
}

/** Re-reads the state when the browser changes its mind. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type InstallResult = 'installed' | 'dismissed' | 'unavailable';

/**
 * Shows the browser's install dialog. The captured event is good for exactly
 * one prompt, so it is dropped either way — a second press with a stale event
 * throws rather than reopening the dialog.
 */
export async function promptInstall(): Promise<InstallResult> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    announce();
    return outcome === 'accepted' ? 'installed' : 'dismissed';
  } catch {
    announce();
    return 'unavailable';
  }
}
