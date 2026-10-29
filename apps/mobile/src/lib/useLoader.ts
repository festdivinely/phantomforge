import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from './api';

/**
 * Loads data when the screen is shown, again every `refreshMs` while it stays
 * shown, and on pull-to-refresh. Keeps the last good data on screen if a
 * refresh fails.
 */
export function useLoader<T>(load: () => Promise<T>, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 500));
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await run();
    setRefreshing(false);
  }, [run]);

  useFocusEffect(
    useCallback(() => {
      void run();
      if (!refreshMs) return undefined;
      const timer = setInterval(() => void run(), refreshMs);
      return () => clearInterval(timer);
    }, [run, refreshMs]),
  );

  return { data, error, refreshing, refresh, reload: run, setData };
}
