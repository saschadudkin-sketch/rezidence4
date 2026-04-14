import { useEffect, useRef } from 'react';
import { isStaff } from '../domain/permissions';
import { sendNotif, playAlert } from '../utils';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';

/**
 * useArrivalNotifier — уведомляет жильца когда охрана отметила приход его гостя.
 * Персоналу уведомление не нужно — они сами регистрируют прибытие.
 */
export function useArrivalNotifier(user: AppUser, requests: AppRequest[]) {
  const prevArrivedIds = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (isStaff(user.role)) return;

    if (isInitialLoadRef.current) {
      // Первый рендер — запоминаем уже известные arrivals без уведомления
      prevArrivedIds.current = new Set(
        requests
          .filter((request) => request.arrivedAt && request.createdByUid === user.uid)
          .map((request) => request.id),
      );
      isInitialLoadRef.current = false;
      return;
    }

    const arrivedNow = requests.filter((request) => request.arrivedAt && request.createdByUid === user.uid);
    for (const request of arrivedNow) {
      if (!prevArrivedIds.current.has(request.id)) {
        prevArrivedIds.current.add(request.id);
        const who = request.visitorName || request.category;
        sendNotif('Гость на территории', `${who} — вход отмечен`, 'arrival');
        playAlert('pass');
      }
    }
  }, [requests, user.uid, user.role]);
}
