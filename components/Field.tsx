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
import { HIT, space, typeStyle } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';
import { useTheme } from '@/theme/useTheme';

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
  /** Grows to a few lines — for prose, like a message to a client. */
  multiline?: boolean;
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
  multiline,
}: Props) {
  const { accentColors, textScale } = usePrefs();
  const { radius } = useSkin();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const progress = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: 160 }), [focused]);

  const border = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [theme.border, accentColors.base]),
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.surface, theme.surfaceHi]),
  }));

  return (
    <View style={styles.wrap}>
      <Text variant="label" color={focused ? accentColors.base : theme.textDim}>
        {label}
      </Text>
      <Animated.View
        style={[styles.box, { borderRadius: radius.md }, multiline && styles.boxTall, border]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textFaint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secureTextEntry}
          autoFocus={autoFocus}
          maxLength={maxLength}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={accentColors.base}
          style={[
            styles.input,
            typeStyle('body', textScale),
            { color: theme.text },
            multiline && styles.inputTall,
          ]}
        />
        {suffix ? (
          <Text variant="label" color={theme.textFaint}>
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
  boxTall: { alignItems: 'flex-start' },
  input: { flex: 1, paddingVertical: space.md },
  // A message is usually two or three lines; taller than that and it scrolls.
  inputTall: { minHeight: 96, maxHeight: 160 },
});
