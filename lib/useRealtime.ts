import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Re-runs `reload` whenever another device writes to any of `tables`.
 *
 * Without this, a screen only refreshes when it regains focus, so Azamat's new
 * truck would not appear on Zafar's phone until he switched tabs. Postgres
 * change events close that gap.
 *
 * The channel name must be unique per subscriber, hence `key`.
 */
export function useRealtime(key: string, tables: string[], reload: () => Promise<void>) {
  const latest = useRef(reload);
  latest.current = reload;

  // Stable across renders so an inline array literal cannot resubscribe forever.
  const signature = tables.join(',');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    // A single sale writes to both `sales` and `trucks`; debounce so that lands
    // as one refetch instead of two.
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void latest.current();
      }, 250);
    };

    const channel = supabase.channel(`live:${key}`);
    for (const table of signature.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [key, signature]);
}
