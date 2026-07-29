import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { listWarnings, setWarningResult } from './api';
import { haptics } from './haptics';
import { supabase } from './supabase';

/** How long after it was raised a warning may still be answered with a position. */
const FRESH_WINDOW_MS = 30 * 60 * 1000;

/**
 * Answers warnings aimed at this customer.
 *
 * Location is read once, in direct response to a specific warning, and only
 * while consent stands. If consent is missing or revoked the warning is closed
 * as 'denied' — there is no silent fallback and nothing is read in the
 * background.
 *
 * Returns whether a position is being read right now, so the UI can show it.
 */
export function useWarnResponder(userId: string | undefined, locationAllowed: boolean): boolean {
  const [sharing, setSharing] = useState(false);
  const handled = useRef<Set<string>>(new Set());
  const allowed = useRef(locationAllowed);
  allowed.current = locationAllowed;

  const respond = useCallback(async (warningId: string) => {
    if (handled.current.has(warningId)) return;
    handled.current.add(warningId);

    if (!allowed.current) {
      await setWarningResult(warningId, 'denied');
      return;
    }

    setSharing(true);
    haptics.warn();
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        await setWarningResult(warningId, 'unavailable');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await setWarningResult(warningId, 'located', {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
    } catch {
      await setWarningResult(warningId, 'unavailable');
    } finally {
      setSharing(false);
    }
  }, []);

  /**
   * Picks up anything raised while the app was closed or backgrounded, but only
   * within FRESH_WINDOW_MS. A warning from last week must not quietly hand over
   * where the customer happens to be standing today.
   */
  const catchUp = useCallback(async () => {
    if (!userId) return;
    try {
      const mine = await listWarnings();
      const cutoff = Date.now() - FRESH_WINDOW_MS;
      const fresh = mine.filter(
        (w) => w.result === 'pending' && new Date(w.created_at).getTime() >= cutoff
      );
      const stale = mine.filter(
        (w) => w.result === 'pending' && new Date(w.created_at).getTime() < cutoff
      );

      await Promise.all([
        ...fresh.map((w) => respond(w.id)),
        // Close the stale ones out honestly rather than leaving them hanging.
        ...stale.map((w) => setWarningResult(w.id, 'unavailable')),
      ]);
    } catch {
      // Offline: the realtime subscription will deliver it once back online.
    }
  }, [userId, respond]);

  useEffect(() => {
    if (!userId) return;

    void catchUp();

    const channel = supabase
      .channel(`warnings:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'warnings',
          filter: `customer_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id: string };
          void respond(row.id);
        }
      )
      .subscribe();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void catchUp();
    });

    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      void catchUp();
    });

    const received = Notifications.addNotificationReceivedListener(() => {
      void catchUp();
    });

    return () => {
      void supabase.removeChannel(channel);
      appState.remove();
      tapped.remove();
      received.remove();
    };
  }, [userId, respond, catchUp]);

  return sharing;
}
