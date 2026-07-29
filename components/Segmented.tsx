import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, palette, space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** iOS-style segmented control with a thumb that springs between options. */
export function Segmented<T extends string | number>({ options, value, onChange }: Props<T>) {
  const { accentColors } = usePrefs();
  const { radius, spring } = useSkin();
  const [width, setWidth] = useState(0);

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const segment = options.length > 0 ? (width - 2 * PAD) / options.length : 0;

  const thumb = useAnimatedStyle(() => ({
    width: segment,
    transform: [{ translateX: withSpring(index * segment, spring) }],
  }));

  return (
    <View
      style={[styles.track, { borderRadius: radius.md }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            { backgroundColor: accentColors.base, borderRadius: radius.sm },
            thumb,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <PressableScale
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            haptic="select"
            to={0.94}
            accessibilityLabel={option.label}
            style={styles.segment}
          >
            <Text variant="label" color={active ? accentColors.on : palette.textDim} center>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const PAD = 3;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: PAD,
    minHeight: HIT,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
  },
  segment: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: space.md,
  },
});
