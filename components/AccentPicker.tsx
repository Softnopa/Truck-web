import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { ACCENTS, ACCENT_NAMES, HIT, radius, space, type AccentName } from '@/theme/tokens';

export function AccentPicker({
  value,
  onChange,
}: {
  value: AccentName;
  onChange: (accent: AccentName) => void;
}) {
  return (
    <View style={styles.row}>
      {ACCENT_NAMES.map((name) => {
        const active = name === value;
        return (
          <PressableScale
            key={name}
            onPress={() => onChange(name)}
            haptic="select"
            to={0.88}
            accessibilityLabel={name}
            style={[
              styles.swatch,
              { backgroundColor: ACCENTS[name].base, borderColor: active ? '#FFFFFF' : 'transparent' },
            ]}
          >
            {active ? (
              <Animated.View entering={FadeIn.duration(160)}>
                <Ionicons name="checkmark" size={20} color={ACCENTS[name].on} />
              </Animated.View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  swatch: {
    width: HIT,
    height: HIT,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
