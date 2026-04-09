import { useEffect, useRef } from 'react';

/**
 * useDebouncedSave — debounces a save/filter callback to a single useEffect.
 *
 * Problem this solves (4.3):
 *   The naive pattern of `useDebounce(value, delay)` + `useEffect(() => fn(debounced), [debounced])`
 *   creates TWO effects per usage (one inside useDebounce, one at the call site).
 *   With 6 such usages across the codebase that would be 12 effects total.
 *
 *   useDebouncedSave collapses both into a SINGLE effect: the timer and the
 *   callback invocation live in the same effect, so cleanup is handled in one place.
 *
 * Usage:
 *   useDebouncedSave(query, (debouncedQuery) => {
 *     setFilteredItems(items.filter(...));
 *   }, isEnabled, 300);
 *
 * Notes:
 *   - `fn` is always called with the latest value — stale-closure safe via ref.
 *   - The effect re-runs when `value` or `delay` changes; `fn` updates silently
 *     via ref so changing the callback never re-schedules the timer.
 *   - Returns nothing — side-effect only. If you need the debounced value for
 *     rendering, use `useDebounce` instead.
 *
 * @param {*} value - The value to debounce.
 * @param {function(*): void} fn - Callback invoked with the debounced value.
 * @param {boolean} enabled - Whether the side effect should run.
 * @param {number} delay - Debounce delay in milliseconds.
 */
export function useDebouncedSave(value, fn, enabled = true, delay = 300) {
  // Keep fn in a ref so changing the callback never restarts the timer.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => fnRef.current(value), delay);
    return () => clearTimeout(timer);
  }, [value, enabled, delay]);
}
