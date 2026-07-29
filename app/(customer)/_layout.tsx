import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { useWarnResponder } from '@/lib/useWarnResponder';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, space, typeStyle } from '@/theme/tokens';

export default function CustomerLayout() {
  const { t, accentColors, textScale } = usePrefs();
  const { session, consent } = useAuth();
  const insets = useSafeAreaInsets();

  const locationAllowed = Boolean(consent?.location_granted && !consent.revoked_at);
  const sharing = useWarnResponder(session?.user.id, locationAllowed);

  return (
    <View style={styles.root}>
      {/* Requirement: a visible indicator whenever location is being shared. */}
      {sharing ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          exiting={FadeOutUp.duration(220)}
          style={[styles.banner, { paddingTop: insets.top + space.sm, backgroundColor: accentColors.base }]}
        >
          <Ionicons name="location" size={16} color={accentColors.on} />
          <Text variant="label" color={accentColors.on}>
            {t('sharingNow')}
          </Text>
        </Animated.View>
      ) : null}

      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: accentColors.base,
          tabBarInactiveTintColor: palette.textFaint,
          tabBarStyle: styles.bar,
          tabBarLabelStyle: typeStyle('caption', Math.min(textScale, 1.15)),
          sceneStyle: { backgroundColor: palette.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabPurchases'),
            tabBarIcon: ({ color, size }) => <Ionicons name="receipt" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('tabSettings'),
            tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
    paddingHorizontal: space.lg,
  },
  bar: {
    backgroundColor: palette.surface,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
