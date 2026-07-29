import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, elevation, palette, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps {
  children: React.ReactNode;
  /** Optional: a card may be press-animated but only act on long-press. */
  onPress?: () => void;
  /** Destructive actions hang off long-press so a stray tap cannot fire them. */
  onLongPress?: () => void;
  /** How far it compresses. Large surfaces need less. */
  to?: number;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  haptic?: 'tap' | 'heavy' | 'select' | 'none';
  accessibilityLabel?: string;
}

/** The single press interaction used everywhere, so every tap feels the same. */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  to = 0.97,
  disabled,
  style,
  haptic = 'tap',
  accessibilityLabel,
}: PressableScaleProps) {
  const { spring, fun } = useSkin();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Fun presses dip further so the overshoot on release is visible.
  const target = fun ? to - 0.03 : to;

  const handlePress = useCallback(() => {
    if (disabled || !onPress) return;
    if (haptic !== 'none') haptics[haptic]();
    onPress();
  }, [disabled, haptic, onPress]);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withSpring(target, spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, spring);
      }}
      onPress={handlePress}
      onLongPress={onLongPress}
      style={[animated, style, disabled && styles.disabled]}
    >
      {children}
    </AnimatedPressable>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  haptic?: 'tap' | 'heavy' | 'select' | 'none';
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
  haptic = 'tap',
}: ButtonProps) {
  const { accentColors } = usePrefs();
  const { fun, radius } = useSkin();

  const labelColor =
    variant === 'primary' ? accentColors.on : variant === 'danger' ? '#FFF5F4' : palette.text;

  const surface: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: accentColors.base, ...elevation.card }
      : variant === 'danger'
        ? { backgroundColor: palette.danger, ...elevation.card }
        : variant === 'secondary'
          ? { backgroundColor: palette.surfaceHi, borderWidth: 1, borderColor: palette.border }
          : { backgroundColor: 'transparent' };

  const body = (
    <View style={styles.inner}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {icon}
          <Text variant="heading" color={labelColor}>
            {label}
          </Text>
        </>
      )}
    </View>
  );

  const filled = variant === 'primary' || variant === 'danger';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      haptic={haptic}
      accessibilityLabel={label}
      style={[styles.button, { borderRadius: radius.md }, fun && filled ? {} : surface, style ?? {}]}
    >
      {fun && filled ? (
        <LinearGradient
          colors={
            variant === 'danger'
              ? [palette.danger, '#B42318']
              : [accentColors.base, accentColors.base + 'B3']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { borderRadius: radius.md }, elevation.raised]}
        >
          {body}
        </LinearGradient>
      ) : (
        body
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: HIT + 8,
    justifyContent: 'center',
  },
  fill: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    minHeight: HIT + 8,
  },
  disabled: { opacity: 0.45 },
});
