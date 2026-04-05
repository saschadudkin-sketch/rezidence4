import { useEffect, useRef } from 'react';
import { isStaff } from '../domain/permissions';
import { sendNotif, playAlert } from '../utils';

/**
 * useArrivalNotifier — уведомляет жильца когда охрана отметила приход его гостя.
 * Персоналу уведомление не нужно — они сами регистрируют прибытие.
 */
export function useArrivalNotifier(user, requests) {
  const prevArrivedIds   = useRef(new Set());
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (isStaff(user.role)) return;

    if (isInitialLoadRef.current) {
      // Первый рендер — запоминаем уже известные arrivals без уведомления
      prevArrivedIds.current = new Set(
        requests
          .filter(r => r.arrivedAt && r.createdByUid === user.uid)
          .map(r => r.id),
      );
      isInitialLoadRef.current = false;
      return;
    }

    const arrivedNow = requests.filter(r => r.arrivedAt && r.createdByUid === user.uid);
    for (const r of arrivedNow) {
      if (!prevArrivedIds.current.has(r.id)) {
        prevArrivedIds.current.add(r.id);
        const who = r.visitorName || r.category;
        sendNotif('Гость на территории', `${who} — вход отмечен`, 'arrival');
        playAlert('pass');
      }
    }
  }, [requests, user.uid, user.role]);
}
