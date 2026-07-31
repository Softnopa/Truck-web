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
import { ScreenLock } from '@/components/ScreenLock';
import { screenUnlocked } from '@/lib/screenLock';
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

  // The lock guards every launch, signed in or not. Signed out it lives on the
  // login page next to the face check; here it only has to cover the case where
  // there is no login page to put it on. Held in memory rather than persisted
  // on purpose: closing the app re-arms it.
  const [drawn, setDrawn] = useState(screenUnlocked);

  // Fonts join the same gate as auth and preferences: holding the splash a
  // moment longer beats letting the whole app repaint in a fallback face.
  const booting = loading || !ready || !fontsReady || (Boolean(session) && !profile);

  useEffect(() => {
    if (booting) return;
    SplashScreen.hideAsync().catch(() => undefined);

    const group = segments[0];

    if (!session) {
      // A sealed session is not the same as no session — the credentials are
      // right here, encrypted, waiting on a face — but it no longer gets a
      // screen of its own. The login page carries the face check and the
      // pattern both, so everyone signed out goes to the same place.
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

  // Before the app itself: whoever picked the device up does not get to see the
  // takings. Read live rather than from state alone, because a face unlocked on
  // the login page settles this too and the session can land here first.
  // Held until the splash is gone, so the lock does not flash over it.
  if (!booting && session && !drawn && !screenUnlocked()) {
    return <ScreenLock onUnlocked={() => setDrawn(true)} />;
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
