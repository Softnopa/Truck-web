import { ScrollView, StyleSheet, View } from 'react-native';
import { PressableScale } from '@/components/Button';
import { Field } from '@/components/Field';
import { Text } from '@/components/Text';
import { FRUITS, fruitLabelKey } from '@/lib/fruits';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, radius, space } from '@/theme/tokens';

/**
 * One input, not a 47-row dropdown: tap a chip for the common case, type for
 * anything else.
 */
export function FruitPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t, accentColors } = usePrefs();
  const current = value.trim().toLowerCase();

  return (
    <View style={styles.wrap}>
      <Field
        label={t('fruit')}
        value={value}
        onChangeText={onChange}
        placeholder={t('fruit')}
        autoCapitalize="sentences"
        maxLength={40}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        {FRUITS.map((fruit) => {
          const active = current === fruit;
          return (
            <PressableScale
              key={fruit}
              onPress={() => onChange(active ? '' : fruit)}
              haptic="select"
              to={0.93}
              accessibilityLabel={t(fruitLabelKey(fruit))}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? accentColors.base : palette.surface,
                  borderColor: active ? accentColors.base : palette.border,
                },
              ]}
            >
              <Text variant="label" color={active ? accentColors.on : palette.textDim}>
                {t(fruitLabelKey(fruit))}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  chips: { gap: space.sm, paddingRight: space.lg },
  chip: {
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
