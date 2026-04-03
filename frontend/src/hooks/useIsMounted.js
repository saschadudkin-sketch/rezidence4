import { useRef, useEffect } from 'react';

/**
 * useIsMounted — возвращает ref, который равен true пока компонент смонтирован.
 * FE-02: устраняет дублирование isMountedRef-паттерна в 6+ компонентах.
 *
 * Использование:
 *   const isMounted = useIsMounted();
 *   // ...после async-операции:
 *   if (isMounted.current) setState(value);
 */
export function useIsMounted() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => { ref.current = false; };
  }, []);
  return ref;
}
