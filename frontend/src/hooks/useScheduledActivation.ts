import { useEffect, useRef } from 'react';

/**
 * Активирует запланированные заявки при монтировании и каждые 30 секунд.
 * Запускает интервал только если есть заявки со статусом 'scheduled'.
 */
export function useScheduledActivation(requests, activateScheduled) {
  const requestsRef = useRef(requests);
  requestsRef.current = requests;

  useEffect(() => {
    // FIX [MED-4]: guard при монтировании симметричен интервалу.
    // Раньше dispatch уходил вхолостую даже при отсутствии scheduled заявок.
    if (requestsRef.current.some(r => r.status === 'scheduled')) {
      activateScheduled();
    }
    const id = setInterval(() => {
      if (requestsRef.current.some(r => r.status === 'scheduled')) {
        activateScheduled();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [activateScheduled]);
}
