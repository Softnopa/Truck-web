import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads on every screen focus, so returning from a modal always shows fresh
 * data without any manual invalidation.
 */
export function useLoader<T>(load: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  const latest = useRef(load);
  latest.current = load;

  const reload = useCallback(async () => {
    try {
      const data = await latest.current();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState((prev) => ({
        data: prev.data,
        loading: false,
        error: e instanceof Error ? e.message : 'error',
      }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  return { ...state, reload };
}
