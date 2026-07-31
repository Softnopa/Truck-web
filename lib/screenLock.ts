/**
 * "This launch has already been unlocked."
 *
 * The pattern and a face stand in front of the same thing, and either settles it
 * for the run: whoever drew the pattern on the login page must not be asked to
 * draw it again the moment they sign in, and a face that opened a sealed session
 * has already proved more than the pattern ever could.
 *
 * Deliberately in memory only. Persisting it would mean closing the app no
 * longer re-arms the lock, which is the whole point of having one.
 */

let unlocked = false;

export function screenUnlocked(): boolean {
  return unlocked;
}

export function markScreenUnlocked(): void {
  unlocked = true;
}
