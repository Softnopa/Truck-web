import { ScrollView, StyleSheet, View } from 'react-native';
import { Card } from '@/components/Card';
import { Text } from '@/components/Text';
import type { Lang } from '@/i18n/strings';
import { formatDateTime } from '@/lib/format';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export interface Pin {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  updatedAt: string;
}

interface Props {
  pins: Pin[];
  focus: Pin | undefined;
  initialRegion: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  accent: string;
  lang: Lang;
}

/**
 * react-native-maps has no browser renderer here — its "web" entry still pulls
 * in native codegen and fails to bundle. The web build is for previewing data
 * on a laptop, not for running the map screen for real, so this lists the same
 * pins as coordinates instead of silently showing a blank box.
 */
export function CustomerPins({ pins, accent, lang }: Props) {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text variant="caption" color={theme.textFaint} style={styles.notice}>
        Map view needs a phone or simulator — showing locations as a list here.
      </Text>
      {pins.map((pin) => (
        <Card key={pin.userId} style={styles.pin}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <View style={styles.pinBody}>
            <Text variant="heading">{pin.name || '—'}</Text>
            <Text variant="caption" color={theme.textFaint}>
              {formatDateTime(pin.updatedAt, lang)}
            </Text>
            <Text variant="caption" color={theme.textFaint} numeric>
              {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
            </Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl },
  notice: { marginBottom: space.xs },
  pin: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  pinBody: { flex: 1, gap: 2 },
});
