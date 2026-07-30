import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * What a list shows instead of zeros. Every empty surface in the app says what
 * is missing and what to do about it.
 */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
}) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name={icon} size={26} color={theme.textFaint} />
      </View>
      <Text variant="heading" center>
        {title}
      </Text>
      <Text variant="body" color={theme.textDim} center style={styles.hint}>
        {hint}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxxl,
    gap: space.md,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  hint: { maxWidth: 280 },
});
