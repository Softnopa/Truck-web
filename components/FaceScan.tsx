import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type ScanState = 'idle' | 'scanning' | 'success' | 'failed';

interface FrameProps {
  state: ScanState;
  size?: number;
  children?: React.ReactNode;
}

/**
 * The Face ID plate: rounded square, corner brackets, and a line that sweeps
 * while something is thinking. Whatever fills it — a face glyph over the OS
 * prompt, or a live camera preview — the wait should look the same and the
 * outcome should be unmistakable.
 */
export function ScanFrame({ state, size = 132, children }: FrameProps) {
  const theme = useTheme();
  const { accentColors } = usePrefs();

  const sweep = useSharedValue(0);
  const pulse = useSharedValue(1);
  const shake = useSharedValue(0);

  const scanning = state === 'scanning';
  const success = state === 'success';
  const failed = state === 'failed';

  const tint = success ? theme.success : failed ? theme.danger : accentColors.base;

  useEffect(() => {
    if (scanning) {
      sweep.value = 0;
      sweep.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      pulse.value = withRepeat(withTiming(1.04, { duration: 900 }), -1, true);
      return;
    }

    cancelAnimation(sweep);
    cancelAnimation(pulse);
    sweep.value = withTiming(0.5, { duration: 180 });
    pulse.value = withSpring(success ? 1.06 : 1, { damping: 12, stiffness: 180 });
  }, [scanning, success, sweep, pulse]);

  useEffect(() => {
    if (!failed) return;
    // Same rhythm as the iOS passcode shake: wrong answer, try again.
    shake.value = withSequence(
      withTiming(-8, { duration: 55 }),
      withTiming(8, { duration: 55 }),
      withTiming(-6, { duration: 55 }),
      withTiming(6, { duration: 55 }),
      withTiming(0, { duration: 55 })
    );
  }, [failed, shake]);

  const plateStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }, { translateX: shake.value }],
  }));

  const lineStyle = useAnimatedStyle(() => ({
    opacity: scanning ? 0.9 : 0,
    transform: [{ translateY: (sweep.value - 0.5) * (size - 36) }],
  }));

  return (
    <Animated.View
      style={[
        styles.plate,
        plateStyle,
        {
          width: size,
          height: size,
          borderRadius: radius.xl,
          borderColor: tint,
          backgroundColor: tint + '14',
        },
      ]}
    >
      {children}

      {/* Sweeping scan line, hidden unless something is working. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.line, lineStyle, { backgroundColor: accentColors.base }]}
      />

      {/* Corner brackets: the bit that reads as "Face ID" at a glance. */}
      <Corner tint={tint} style={styles.tl} />
      <Corner tint={tint} style={styles.tr} />
      <Corner tint={tint} style={styles.bl} />
      <Corner tint={tint} style={styles.br} />
    </Animated.View>
  );
}

/**
 * The plate with a face glyph in it. Decoration over `navigator.credentials` —
 * the actual biometric prompt is drawn by the OS and cannot be styled — so the
 * job here is to make the wait legible.
 */
export function FaceScan({ state, size = 132 }: { state: ScanState; size?: number }) {
  const theme = useTheme();
  const { accentColors } = usePrefs();

  return (
    <ScanFrame state={state} size={size}>
      {state === 'success' ? (
        <Ionicons name="checkmark" size={size * 0.46} color={theme.success} />
      ) : (
        <MaterialCommunityIcons
          name="face-recognition"
          size={size * 0.52}
          color={state === 'failed' ? theme.danger : accentColors.base}
        />
      )}
    </ScanFrame>
  );
}

function Corner({ tint, style }: { tint: string; style: object }) {
  return <View style={[styles.corner, style, { borderColor: tint }]} />;
}

const BRACKET = 20;

const styles = StyleSheet.create({
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  line: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
  },
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
  },
  tl: { top: 8, left: 8, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  tr: { top: 8, right: 8, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bl: { bottom: 8, left: 8, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  br: { bottom: 8, right: 8, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
});
