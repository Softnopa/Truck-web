import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { elevation, palette, radius as calmRadius, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  const { fun, radius } = useSkin();
  const { accentColors } = usePrefs();

  const shape: ViewStyle = {
    borderRadius: radius.lg,
    borderColor: fun ? accentColors.soft : palette.border,
    borderWidth: fun ? 1.5 : 1,
  };

  // Fun swaps the flat surface for a soft vertical gradient with an accent cast.
  if (fun) {
    return (
      <LinearGradient
        colors={[palette.surfaceHi, palette.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, shape, elevation.raised, style]}
      >
        {children}
      </LinearGradient>
    );
  }

  return <View style={[styles.card, shape, elevation.card, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** Small uppercase label that opens a group of settings or a list section. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <Text variant="caption" color={palette.textFaint} style={styles.section}>
      {title.toUpperCase()}
    </Text>
  );
}

export function Avatar({ text, color }: { text: string; color: string }) {
  const { radius } = useSkin();
  return (
    <View style={[styles.avatar, { backgroundColor: color, borderRadius: radius.pill }]}>
      <Text variant="label" color={palette.bg}>
        {text}
      </Text>
    </View>
  );
}

/** Coloured, low-contrast status pill. */
export function Badge({ label, color, soft }: { label: string; color: string; soft: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    padding: space.base,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: space.md,
  },
  section: {
    letterSpacing: 1.1,
    marginBottom: space.sm,
    marginTop: space.lg,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: calmRadius.pill,
    alignSelf: 'flex-start',
  },
});
