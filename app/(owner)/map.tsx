import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Card } from '@/components/Card';
import { CustomerPins, type Pin } from '@/components/CustomerPins';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { listCustomerLocations, listProfiles } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

async function loadPins(): Promise<Pin[]> {
  const [locations, profiles] = await Promise.all([listCustomerLocations(), listProfiles()]);
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  return locations
    .map((l) => ({
      userId: l.user_id,
      name: nameById.get(l.user_id) ?? '',
      lat: l.lat,
      lng: l.lng,
      updatedAt: l.updated_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Tashkent — where this business operates, used only as an initial viewport. */
const INITIAL_REGION = {
  latitude: 41.2995,
  longitude: 69.2401,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

// Not named `Map`: that would shadow the global constructor used in loadPins.
export default function CustomerMap() {
  const { t, lang, accentColors } = usePrefs();
  const theme = useTheme();
  const { data, loading, reload } = useLoader(useCallback(loadPins, []));
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);

  useRealtime('customer-locations', ['customer_locations'], reload);

  const pins = useMemo(() => data ?? [], [data]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pins;
    return pins.filter((p) => p.name.toLowerCase().includes(needle));
  }, [pins, query]);

  const focus = shown.find((p) => p.userId === focusId);

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.headerWrap}>
        <Header title={t('customerMap')} subtitle={t('sharingCount', { n: pins.length })} />
        <Field
          label={t('search')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchCustomers')}
          autoCapitalize="words"
          maxLength={40}
        />
      </View>

      {pins.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState
            icon="map-outline"
            title={loading ? t('loading') : t('noLocations')}
            hint={t('noLocationsHint')}
          />
        </View>
      ) : (
        <View style={styles.mapWrap}>
          {/* .native.tsx renders react-native-maps; .web.tsx renders a pin list —
              react-native-maps has no working browser build in this project. */}
          <CustomerPins
            pins={shown}
            focus={focus}
            initialRegion={INITIAL_REGION}
            accent={accentColors.base}
            lang={lang}
          />

          {shown.length === 0 ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.callout}>
              <Card>
                <Text variant="heading">{t('noMatches')}</Text>
                <Text variant="label" color={theme.textDim}>
                  {t('noMatchesHint')}
                </Text>
              </Card>
            </Animated.View>
          ) : (
            <View style={styles.strip}>
              <FlatList
                data={shown}
                keyExtractor={(item) => item.userId}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stripContent}
                renderItem={({ item }) => {
                  const active = item.userId === focusId;
                  return (
                    <PressableScale
                      onPress={() => setFocusId(active ? null : item.userId)}
                      to={0.96}
                      accessibilityLabel={item.name}
                    >
                      <Card
                        style={
                          active
                            ? { borderColor: accentColors.base, minWidth: 170 }
                            : { minWidth: 170 }
                        }
                      >
                        <View style={styles.cardRow}>
                          <Ionicons
                            name="location"
                            size={14}
                            color={active ? accentColors.base : theme.textFaint}
                          />
                          <Text variant="heading" numberOfLines={1} style={styles.cardName}>
                            {item.name || t('none')}
                          </Text>
                        </View>
                        <Text variant="caption" color={theme.textFaint}>
                          {formatDateTime(item.updatedAt, lang)}
                        </Text>
                      </Card>
                    </PressableScale>
                  );
                }}
              />
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md },
  empty: { flex: 1, paddingHorizontal: space.lg, justifyContent: 'center' },
  mapWrap: { flex: 1, overflow: 'hidden', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  callout: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg },
  strip: { position: 'absolute', left: 0, right: 0, bottom: space.lg },
  stripContent: { gap: space.md, paddingHorizontal: space.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardName: { flex: 1 },
});
