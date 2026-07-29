import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { HIT, palette, space } from '@/theme/tokens';

/** Label + description on the left, any control on the right. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="caption" color={palette.textFaint}>
            {description}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { accentColors } = usePrefs();
  return (
    <SettingRow label={label} description={description}>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: palette.borderHi, true: accentColors.base }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={palette.borderHi}
      />
    </SettingRow>
  );
}

/** Stacked label above a full-width control, for segmented pickers. */
export function SettingBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text variant="body">{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.base,
    minHeight: HIT,
  },
  text: { flex: 1, gap: 2 },
  block: { gap: space.md },
});
