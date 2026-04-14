import { useEffect, useRef } from 'react';

export function useDebouncedSave<T>(state: T, saveFn: (arg: T) => void, enabled: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    pendingStateRef.current = state;
    timer.current = setTimeout(() => {
      timer.current = null;
      pendingStateRef.current = null;
      saveFn(state);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, saveFn, enabled]);

  useEffect(() => {
    return () => {
      if (timer.current !== null && pendingStateRef.current !== null) {
        clearTimeout(timer.current);
        saveFn(pendingStateRef.current);
      }
    };
  }, [saveFn]);
}
