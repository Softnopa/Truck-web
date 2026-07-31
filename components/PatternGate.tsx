import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { PatternPad, type PadState } from '@/components/PatternPad';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import {
  failedAttempts,
  MAX_ATTEMPTS,
  MIN_DOTS,
  patternMatches,
  recordFailure,
  resetAttempts,
} from '@/lib/patternLock';
import { markScreenUnlocked } from '@/lib/screenLock';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Props {
  /** Called once the pattern is right, so the gate can stand down. */
  onUnlocked: () => void;
  /**
   * Rendered inside the login page, under the face check, rather than owning a
   * screen of its own.
   */
  embedded?: boolean;
}

/**
 * The pattern standing in front of the app on every launch.
 *
 * Signed in, drawing it opens the app; signed out, it is the passcode on the
 * login page and drawing it reveals the sign-in form. Five wrong patterns drop
 * the session — see `signOut` below — so a found phone cannot be poked at
 * indefinitely. It is a screen lock rather than a second credential;
 * `lib/patternLock` says why in more detail.
 */
export function PatternGate({ onUnlocked, embedded }: Props) {
  const { t } = usePrefs();
  const theme = useTheme();
  const { session, signOut } = useAuth();

  const [state, setState] = useState<PadState>('idle');
  const [attempts, setAttempts] = useState(0);
  const [justSignedOut, setJustSignedOut] = useState(false);

  // Carried over from the last run: a reload must not hand back five fresh guesses.
  useEffect(() => {
    void failedAttempts().then(setAttempts);
  }, []);

  const handle = (dots: number[]) => {
    if (state === 'success') return;

    // Too short to be the pattern at all — a slip while scrolling, not a guess.
    if (dots.length < MIN_DOTS) {
      setState('error');
      return;
    }

    if (patternMatches(dots)) {
      haptics.saved();
      setState('success');
      setJustSignedOut(false);
      // Settled for the whole run, wherever the pattern was drawn: signing in
      // straight afterwards must not put the same grid back on screen.
      markScreenUnlocked();
      void resetAttempts();
      // Long enough for the trail to land on green before the app appears.
      setTimeout(onUnlocked, 220);
      return;
    }

    haptics.failed();
    setState('error');

    void (async () => {
      const count = await recordFailure();
      setAttempts(count);
      if (count < MAX_ATTEMPTS) return;

      // Out of tries: drop the session. The pattern is still required
      // afterwards, so what they have lost is the signed-in state — from here
      // it is back to email and password.
      await resetAttempts();
      setAttempts(0);
      if (session) {
        await signOut();
        setJustSignedOut(true);
      }
    })();
  };

  const remaining = Math.max(0, MAX_ATTEMPTS - attempts);

  const caption = justSignedOut
    ? t('patternSignedOut')
    : state === 'success'
      ? t('patternUnlocked')
      : state === 'error'
        ? attempts > 0
          ? t('patternAttemptsLeft', { n: remaining })
          : t('patternTooShort')
        : t('patternHint');

  const bad = state === 'error' || justSignedOut;

  const body = (
    <View style={embedded ? styles.block : styles.wrap}>
      <Animated.View
        entering={FadeIn.duration(260)}
        style={[styles.head, { gap: embedded ? space.sm : space.base }]}
      >
        <Ionicons
          name={state === 'success' ? 'lock-open' : 'lock-closed'}
          size={embedded ? 24 : 34}
          color={state === 'success' ? theme.success : bad ? theme.danger : theme.text}
        />
        <Text variant={embedded ? 'heading' : 'title'} center>
          {t('patternTitle')}
        </Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(80).duration(320)}
        style={[styles.pad, { gap: embedded ? space.base : space.xl }]}
      >
        <Text variant="label" center color={bad ? theme.danger : theme.textDim}>
          {caption}
        </Text>

        {/* The red stays until the next touch begins, rather than clearing on
            a timer — it is on screen for exactly as long as it is being read. */}
        <PatternPad
          onComplete={handle}
          onStart={() => {
            if (state === 'error') setState('idle');
            setJustSignedOut(false);
          }}
          state={state}
          disabled={state === 'success'}
          size={embedded ? 224 : 264}
        />
      </Animated.View>
    </View>
  );

  if (embedded) return body;
  return <Screen edges={['top', 'left', 'right', 'bottom']}>{body}</Screen>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xxl },
  block: { alignItems: 'center', gap: space.base },
  head: { alignItems: 'center' },
  pad: { alignItems: 'center' },
});
