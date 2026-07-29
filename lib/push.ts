import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | null {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas = Constants.easConfig?.projectId;
  const id = typeof fromConfig === 'string' ? fromConfig : fromEas;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Returns the Expo push token and stores it against the user, or null when the
 * device cannot receive push. A null result is expected on simulators and
 * before `eas init` has assigned the project an id — the warn flow degrades to
 * its realtime channel rather than failing.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!Device.isDevice) return null;

  const id = projectId();
  if (!id) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('warnings', {
      name: 'Warnings',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await supabase.from('push_tokens').upsert(
      { user_id: userId, token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      { onConflict: 'user_id,token' }
    );
    return token;
  } catch {
    return null;
  }
}

export async function clearPushTokens(userId: string): Promise<void> {
  await supabase.from('push_tokens').delete().eq('user_id', userId);
}

/**
 * Expo's push endpoint is unauthenticated, so an owner's device can deliver the
 * warning directly and no server component is required.
 */
export async function sendPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>
): Promise<boolean> {
  if (tokens.length === 0) return false;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title,
          body,
          data,
          sound: 'default',
          priority: 'high',
          channelId: 'warnings',
          interruptionLevel: 'time-sensitive',
        }))
      ),
    });
    return res.ok;
  } catch {
    return false;
  }
}
