import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { radius, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';
import { useTheme } from '@/theme/useTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/**
 * Two full turns of the spectrum, so the sweep can translate by exactly half
 * its width and land where it started — a seam anywhere in that loop reads as
 * a stutter every few seconds.
 */
const SPECTRUM = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF2D55',
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF2D55',
] as const;

/**
 * One turn of the spectrum. The gradient below is laid out two of these wide,
 * and the sweep slides by exactly this much.
 */
const CYCLE = 900;

/** How far past the button the glow bleeds, in points. */
const BLEED = 26;

interface Props {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * The Growth button: one press, the whole screen, impossible to miss.
 *
 * The rainbow is three cooperating layers rather than one image. A bleeding
 * copy behind the card is the glow; a wide gradient sliding under a clipped
 * ring is the colour travelling around the edge; and the face on top stays a
 * flat surface colour so the label is still a label rather than something
 * fighting the light behind it.
 *
 * All of it runs on the UI thread through Reanimated, so the sweep does not
 * stutter while the press is being handled or while the report is in flight.
 */
export function RainbowButton({ label, hint, icon, onPress, busy, disabled }: Props) {
  const theme = useTheme();
  const { spring } = useSkin();

  const sweep = useSharedValue(0);
  const press = useSharedValue(0);
  const breathe = useSharedValue(0);

  const off = disabled || busy;

  useEffect(() => {
    // Linear, and never eased: an eased loop visibly hesitates at the seam.
    sweep.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.linear }), -1, false);
    breathe.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(breathe);
    };
  }, [sweep, breathe]);

  /**
   * Exactly one spectrum, which is half the doubled gradient — at the end of
   * the travel the visible slice is pixel-for-pixel the one it started on, so
   * the jump back to zero cannot be seen. Sliding any other distance puts a
   * visible seam in the loop every few seconds.
   */
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -CYCLE * sweep.value }],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(press.value, [0, 1], [1, 0.965]) }],
  }));

  // Pressing does not just shrink the card — the glow swells to meet it, which
  // is what makes the press feel like it powered something on.
  const glowStyle = useAnimatedStyle(() => {
    const idle = interpolate(breathe.value, [0, 1], [0.34, 0.52]);
    return {
      opacity: off ? 0.16 : idle + press.value * 0.34,
      transform: [{ scale: interpolate(press.value, [0, 1], [1, 1.06]) }],
    };
  });

  return (
    <View style={styles.slot}>
      {/* Behind everything, and untouchable: the bleed is decoration only. */}
      <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
        <View style={styles.clip}>
          <AnimatedGradient
            colors={SPECTRUM}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.wide, sweepStyle]}
          />
        </View>
      </Animated.View>

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(off) }}
        disabled={off}
        onPressIn={() => {
          press.value = withSpring(1, spring);
        }}
        onPressOut={() => {
          press.value = withSpring(0, spring);
        }}
        // Web only, and harmless elsewhere: the same swell on hover, so a
        // desktop owner gets the affordance a finger gets for free.
        onHoverIn={() => {
          press.value = withSpring(0.45, spring);
        }}
        onHoverOut={() => {
          press.value = withSpring(0, spring);
        }}
        onPress={() => {
          if (off) return;
          haptics.heavy();
          onPress();
        }}
        style={[styles.card, cardStyle]}
      >
        {/* The ring: the same travelling spectrum, clipped to the border. */}
        <View style={styles.ring}>
          <AnimatedGradient
            colors={SPECTRUM}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.wide, sweepStyle]}
          />
        </View>

        <View style={[styles.face, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {/* A wash of the same colours across the face, faint enough that the
              text never has to compete with it. */}
          <AnimatedGradient
            pointerEvents="none"
            colors={SPECTRUM}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.wide, styles.wash, sweepStyle]}
          />

          <View style={styles.content}>
            {busy ? <ActivityIndicator size="large" color={theme.text} /> : icon}

            <Text variant="display" center style={styles.label}>
              {label}
            </Text>

            {hint ? (
              <Text variant="label" color={theme.textDim} center>
                {hint}
              </Text>
            ) : null}
          </View>
        </View>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, justifyContent: 'center' },
  glow: {
    position: 'absolute',
    left: -BLEED,
    right: -BLEED,
    top: -BLEED,
    bottom: -BLEED,
  },
  clip: { flex: 1, borderRadius: radius.xl + BLEED, overflow: 'hidden' },
  card: { flex: 1 },
  ring: { flex: 1, borderRadius: radius.xl, overflow: 'hidden' },
  /**
   * Two full cycles. The sweep slides by one of them, so the second is what
   * stays under the button for the whole travel — hence twice, not once.
   */
  wide: { position: 'absolute', top: 0, bottom: 0, left: 0, width: CYCLE * 2 },
  wash: { opacity: 0.13 },
  face: {
    ...StyleSheet.absoluteFillObject,
    // The ring is this inset made visible — the gradient shows only where the
    // face does not cover it.
    margin: 3,
    borderRadius: radius.xl - 3,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', gap: space.base, paddingHorizontal: space.xl },
  label: { letterSpacing: 1.5 },
});
