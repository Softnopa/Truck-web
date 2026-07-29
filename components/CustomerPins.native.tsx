import { StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { Lang } from '@/i18n/strings';
import { formatDateTime } from '@/lib/format';

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

/** Native map surface — iOS/Android only. See CustomerPins.web.tsx for the browser fallback. */
export function CustomerPins({ pins, focus, initialRegion, accent, lang }: Props) {
  return (
    <MapView
      provider={PROVIDER_DEFAULT}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      region={
        focus
          ? {
              latitude: focus.lat,
              longitude: focus.lng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }
          : undefined
      }
    >
      {pins.map((pin) => (
        <Marker
          key={pin.userId}
          coordinate={{ latitude: pin.lat, longitude: pin.lng }}
          title={pin.name}
          description={formatDateTime(pin.updatedAt, lang)}
          pinColor={accent}
        />
      ))}
    </MapView>
  );
}
