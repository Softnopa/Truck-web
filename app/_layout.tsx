import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { PreferencesProvider, usePrefs } from '@/providers/PreferencesProvider';
import { palette } from '@/theme/tokens';

// `void` silences the linter but attaches no rejection handler. expo-splash-screen
// rejects when the native splash is already gone (common on a Fast Refresh), and
// that surfaced as "Uncaught (in promise, id: 1)". Swallow it explicitly.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const OWNER_HOME = '/(owner)/trucks';
const CUSTOMER_HOME = '/(customer)';

/**
 * Single source of truth for where a user is allowed to be:
 * no session -> sign-in, undecided customer -> permissions, otherwise the home
 * for their role. Roles are also enforced by RLS; this only keeps the UI honest.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const { loading, session, profile, hasAnswered, isOwner } = useAuth();
  const { ready } = usePrefs();
  const segments = useSegments();
  const router = useRouter();

  const booting = loading || !ready || (Boolean(session) && !profile);

  useEffect(() => {
    if (booting) return;
    SplashScreen.hideAsync().catch(() => undefined);

    const group = segments[0];

    if (!session) {
      if (group !== 'sign-in') router.replace('/sign-in');
      return;
    }

    if (!hasAnswered) {
      if (group !== 'permissions') router.replace('/permissions');
      return;
    }

    const home = isOwner ? OWNER_HOME : CUSTOMER_HOME;
    const inWrongRole =
      (isOwner && group === '(customer)') || (!isOwner && group === '(owner)');

    if (group === undefined || group === 'sign-in' || group === 'permissions' || inWrongRole) {
      router.replace(home);
    }
  }, [booting, session, hasAnswered, isOwner, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <AuthProvider>
            <Gate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.bg },
                  animation: 'slide_from_right',
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
                <Stack.Screen name="permissions" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen name="(owner)" options={{ animation: 'fade' }} />
                <Stack.Screen name="(customer)" options={{ animation: 'fade' }} />
                <Stack.Screen name="customer/[id]" />
                <Stack.Screen
                  name="new-truck"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="new-sale"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="edit-truck"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="edit-customer"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen
                  name="new-client"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
              </Stack>
            </Gate>
          </AuthProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
