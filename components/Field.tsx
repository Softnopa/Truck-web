import { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, palette, space, typeStyle } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';

interface Props {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Shown when the field is empty. The app never pre-fills a literal 0. */
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  suffix?: string;
  autoFocus?: boolean;
  maxLength?: number;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  secureTextEntry,
  suffix,
  autoFocus,
  maxLength,
}: Props) {
  const { accentColors, textScale } = usePrefs();
  const { radius } = useSkin();
  const [focused, setFocused] = useState(false);

  const progress = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: 160 }), [focused]);

  const border = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [palette.border, accentColors.base]),
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [palette.surface, palette.surfaceHi]
    ),
  }));

  return (
    <View style={styles.wrap}>
      <Text variant="label" color={focused ? accentColors.base : palette.textDim}>
        {label}
      </Text>
      <Animated.View style={[styles.box, { borderRadius: radius.md }, border]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secureTextEntry}
          autoFocus={autoFocus}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={accentColors.base}
          style={[styles.input, typeStyle('body', textScale), { color: palette.text }]}
        />
        {suffix ? (
          <Text variant="label" color={palette.textFaint}>
            {suffix}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  box: {
    minHeight: HIT + 6,
    borderWidth: 1.5,
    paddingHorizontal: space.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  input: { flex: 1, paddingVertical: space.md },
});
