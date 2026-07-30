import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { PressableScale } from '@/components/Button';
import { Text } from '@/components/Text';
import { useClock } from '@/lib/useClock';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';
import { useTheme } from '@/theme/useTheme';

interface Props {
  title: string;
  subtitle?: string;
  /** Single round action, kept top-right and thumb-safe at 44pt. */
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onAction?: () => void;
  actionLabel?: string;
  onBack?: () => void;
  /** Makes the title itself tappable, e.g. to edit the record it names. */
  onTitlePress?: () => void;
}

export function Header({
  title,
  subtitle,
  actionIcon,
  onAction,
  actionLabel,
  onBack,
  onTitlePress,
}: Props) {
  const { accentColors, lang } = usePrefs();
  const { radius } = useSkin();
  const theme = useTheme();
  const clock = useClock(lang);

  // Only the screens you land on, never the ones you drill into: a back button
  // means this is a task in progress, where a clock is noise.
  const showClock = !onBack;

  const titles = (
    <View style={styles.titles}>
      <View style={styles.titleRow}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
        {onTitlePress ? (
          <Ionicons name="create-outline" size={18} color={theme.textFaint} />
        ) : null}
      </View>
      {subtitle ? (
        <Text variant="label" color={theme.textDim} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.wrap}>
      {onBack ? (
        <PressableScale onPress={onBack} to={0.9} style={styles.back} accessibilityLabel={title}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </PressableScale>
      ) : null}

      {onTitlePress ? (
        <PressableScale onPress={onTitlePress} to={0.98} style={styles.titles}>
          {titles}
        </PressableScale>
      ) : (
        titles
      )}

      {showClock ? (
        <Text variant="label" numeric color={theme.textDim}>
          {clock}
        </Text>
      ) : null}

      {actionIcon && onAction ? (
        <PressableScale
          onPress={onAction}
          to={0.9}
          accessibilityLabel={actionLabel ?? ''}
          style={[styles.action, { backgroundColor: accentColors.base, borderRadius: radius.md }]}
        >
          <Ionicons name={actionIcon} size={24} color={accentColors.on} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.md,
    paddingBottom: space.base,
  },
  titles: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  back: {
    width: HIT,
    height: HIT,
    marginLeft: -space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
