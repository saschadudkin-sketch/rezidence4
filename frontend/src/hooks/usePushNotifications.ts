import { useEffect, useRef } from 'react';
import { isResident } from '../domain/permissions';
import { canManageRequests } from '../domain/permissions';
import { subscribePush } from '../services/pushNotification';

/**
 * usePushNotifications — подписка на Web Push и обновление PWA App Badge.
 * Подписка на push — только для жильцов (owner, tenant, contractor).
 * Badge — для всех: персонал видит кол-во pending, жильцы — unreadMsgs.
 */
export function usePushNotifications(user, { pendingT, pendingP, unreadMsgs }) {
  const pushSubscribedUidRef = useRef(null);

  useEffect(() => {
    if (isResident(user.role)) {
      if (pushSubscribedUidRef.current !== user.uid) {
        pushSubscribedUidRef.current = user.uid;
        subscribePush();
      }
    } else {
      pushSubscribedUidRef.current = null;
    }
  }, [user.role, user.uid]);

  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const total = canManageRequests(user.role) ? pendingT + pendingP : unreadMsgs;
    if (total > 0) navigator.setAppBadge(total).catch(() => {});
    else           navigator.clearAppBadge().catch(() => {});
  }, [pendingT, pendingP, unreadMsgs, user.role]);
}
