import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, typeStyle } from '@/theme/tokens';

export default function OwnerLayout() {
  const { t, accentColors, textScale } = usePrefs();

  return (
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
        name="trucks"
        options={{
          title: t('tabTrucks'),
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: t('tabCustomers'),
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: t('tabClients'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="paper-plane" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t('tabMap'),
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
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
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: palette.surface,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
