import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export const LOCATION_TASK = 'truck-app-background-location';

/**
 * Bumped whenever the consent terms materially change. A customer whose stored
 * `consent_version` is below this answered under different terms and is routed
 * back through /permissions before any tracking starts.
 *
 * v1: location read only in the moment of a warning.
 * v2: continuous background tracking.
 */
export const CURRENT_CONSENT_VERSION = 2;

/**
 * The background task has no React context and no session in memory, so the
 * user id is parked here for it to read.
 */
const USER_KEY = 'tracking:user-id';

async function writeLocation(userId: string, coords: Location.LocationObjectCoords) {
  await supabase.from('customer_locations').upsert(
    {
      user_id: userId,
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  const userId = await AsyncStorage.getItem(USER_KEY);
  if (!userId) return;

  try {
    await writeLocation(userId, latest.coords);
  } catch {
    // Offline: the next fix overwrites this one anyway, so dropping it is fine.
  }
});

/** Both foreground and background grants are required; either alone is useless here. */
export async function requestTrackingPermissions(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted';
}

export async function startTracking(userId: string): Promise<boolean> {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  if (foreground.status !== 'granted' || background.status !== 'granted') return false;

  await AsyncStorage.setItem(USER_KEY, userId);

  // Write one fix immediately so an owner sees the customer without waiting for
  // them to physically move far enough to trigger the first background update.
  try {
    const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await writeLocation(userId, now.coords);
  } catch {
    // A missing first fix is not a reason to skip starting the task.
  }

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running) return true;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5 * 60 * 1000,
    distanceInterval: 150,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: true,
    ...(Platform.OS === 'android'
      ? {
          foregroundService: {
            notificationTitle: 'Location sharing is on',
            notificationBody: 'Your location is shared with the business owners.',
          },
        }
      : {}),
  });

  return true;
}

export async function stopTracking(userId?: string): Promise<void> {
  await AsyncStorage.removeItem(USER_KEY);

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  // Turning sharing off removes the position too — leaving the last known one
  // visible would keep showing the owner where they were after they said stop.
  if (userId) await supabase.from('customer_locations').delete().eq('user_id', userId);
}
