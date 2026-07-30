import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '@/components/LockScreen';
import { disable as disableFaceLock, hasLockedSession } from '@/lib/faceLock';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { PreferencesProvider, usePrefs } from '@/providers/PreferencesProvider';
import { darkPalette } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

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
function Gate({ children, fontsReady }: { children: React.ReactNode; fontsReady: boolean }) {
  const { loading, session, profile, hasAnswered, isOwner } = useAuth();
  const { ready } = usePrefs();
  const segments = useSegments();
  const router = useRouter();

  // A sealed session is not the same as no session: the credentials are right
  // here, encrypted, waiting on the owner's face. Falling through to sign-in
  // would ask for a password the whole feature exists to avoid.
  const [locked, setLocked] = useState(() => hasLockedSession());

  // Fonts join the same gate as auth and preferences: holding the splash a
  // moment longer beats letting the whole app repaint in a fallback face.
  const booting = loading || !ready || !fontsReady || (Boolean(session) && !profile);

  useEffect(() => {
    if (booting) return;
    SplashScreen.hideAsync().catch(() => undefined);

    const group = segments[0];

    if (!session) {
      // Re-checked rather than trusted from mount: arming face unlock mid-session
      // drops the local session on purpose, and that must land on the lock, not
      // on a password prompt.
      if (locked) return;
      if (hasLockedSession()) {
        setLocked(true);
        return;
      }
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
  }, [booting, session, hasAnswered, isOwner, segments, router, locked]);

  // Held until the splash is gone, so the lock does not flash over it.
  if (!booting && locked && !session) {
    return (
      <LockScreen
        onUnlocked={() => setLocked(false)}
        onUsePassword={() => {
          // Abandoning the vault beats leaving a stale one: after signing in
          // they re-arm from settings in a tap, and there is no half state.
          disableFaceLock();
          setLocked(false);
        }}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Split out so it sits *inside* PreferencesProvider — `useTheme` reads that
 * context, and the root view below the provider cannot.
 */
function ThemedStack() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
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
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  // A font that fails to load must not hold the app hostage — the ramp falls
  // back to the system face and everything still works.
  const fontsReady = fontsLoaded || Boolean(fontError);

  return (
    // Static dark ground: this sits above the provider, and it is only ever
    // visible behind the themed screens during a transition.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: darkPalette.bg }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <AuthProvider>
            <Gate fontsReady={fontsReady}>
              <ThemedStack />
            </Gate>
          </AuthProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
