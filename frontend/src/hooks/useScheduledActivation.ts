import { useEffect, useRef } from 'react';
import type { AppRequest } from '../store/slices/requestsSlice';

/**
 * Активирует запланированные заявки при монтировании и каждые 30 секунд.
 * Запускает интервал только если есть заявки со статусом 'scheduled'.
 */
export function useScheduledActivation(requests: AppRequest[], activateScheduled: () => void) {
  const requestsRef = useRef<AppRequest[]>(requests);
  requestsRef.current = requests;

  useEffect(() => {
    activateScheduled();
    const id = setInterval(() => {
      if (requestsRef.current.some((request) => request.status === 'scheduled')) {
        activateScheduled();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [activateScheduled]);
}
