import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { PressableScale } from '@/components/Button';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, palette, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';

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
  const { accentColors } = usePrefs();
  const { radius } = useSkin();

  const titles = (
    <View style={styles.titles}>
      <View style={styles.titleRow}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
        {onTitlePress ? (
          <Ionicons name="create-outline" size={18} color={palette.textFaint} />
        ) : null}
      </View>
      {subtitle ? (
        <Text variant="label" color={palette.textDim} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.wrap}>
      {onBack ? (
        <PressableScale onPress={onBack} to={0.9} style={styles.back} accessibilityLabel={title}>
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </PressableScale>
      ) : null}

      {onTitlePress ? (
        <PressableScale onPress={onTitlePress} to={0.98} style={styles.titles}>
          {titles}
        </PressableScale>
      ) : (
        titles
      )}

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
