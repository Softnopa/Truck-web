import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The unlock pattern standing in front of the app.
 *
 * Be clear about what this is: a **screen lock, not authentication**. The
 * pattern lives in the shipped bundle, it is the same for every owner, and the
 * real credential is still the Supabase password. It stops someone picking up
 * an unattended phone at the stall and reading the day's takings; it does not
 * stop anyone who can reach the API directly. Weak passwords remain worth
 * fixing on their own.
 *
 * Dots are numbered left to right, top to bottom:
 *
 *     0 1 2
 *     3 4 5
 *     6 7 8
 */

export const GRID = 3;

/**
 * Along the top, down the right, left along the bottom, then up into the
 * middle — a "G". The two dots down the left, 3 and 6, are never touched.
 *
 *     ●─●─●
 *     ·  ● │
 *     ·  ●─●
 */
export const PATTERN: readonly number[] = [0, 1, 2, 5, 8, 7, 4];

/** Fewer than this and it is a slip, not an attempt. */
export const MIN_DOTS = 4;

/** Wrong this many times and the session is dropped. */
export const MAX_ATTEMPTS = 5;

const ATTEMPTS_KEY = 'truck.pattern.attempts';

export function patternMatches(drawn: readonly number[]): boolean {
  return drawn.length === PATTERN.length && drawn.every((dot, i) => dot === PATTERN[i]);
}

/**
 * The count survives a reload on purpose — otherwise refreshing the page would
 * hand back a fresh five guesses, and the limit would mean nothing.
 */
export async function failedAttempts(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPTS_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function recordFailure(): Promise<number> {
  const next = (await failedAttempts()) + 1;
  try {
    await AsyncStorage.setItem(ATTEMPTS_KEY, String(next));
  } catch {
    // Storage refused: the in-memory count still governs this run.
  }
  return next;
}

export async function resetAttempts(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    // Nothing to do — a stale count only ever costs an extra sign-in.
  }
}

/**
 * The dot passed over when stepping between two others in a straight line, so
 * dragging from 0 to 2 picks up 1 the way a phone's own lock screen does.
 * Returns null when the two are adjacent, diagonal or unaligned.
 */
export function dotBetween(from: number, to: number): number | null {
  const [fromRow, fromCol] = [Math.floor(from / GRID), from % GRID];
  const [toRow, toCol] = [Math.floor(to / GRID), to % GRID];

  const rowSum = fromRow + toRow;
  const colSum = fromCol + toCol;
  if (rowSum % 2 !== 0 || colSum % 2 !== 0) return null;

  const mid = (rowSum / 2) * GRID + colSum / 2;
  return mid === from || mid === to ? null : mid;
}
