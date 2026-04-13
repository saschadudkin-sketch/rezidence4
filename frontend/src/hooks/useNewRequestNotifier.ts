import { useRef } from 'react';
import { canManageRequests } from '../domain/permissions';
import { ROLES } from '../domain/permissions';
import { isSecurityActionablePass } from '../domain/passLifecycle';
import { sendNotif, playAlert } from '../utils';

/**
 * useNewRequestNotifier — fires browser notifications + audio alerts when new
 * pending requests arrive via SSE. Extracted from useLiveSync (ARCH-2) so that
 * notification policy lives separately from sync infrastructure.
 *
 * Returns a stable `notify(docs)` callback that can be called from the SSE
 * onRequests handler. The callback reads the latest user values via a ref so
 * useLiveSync can call it without restarting the SSE effect.
 */
export function useNewRequestNotifier(user) {
  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);
  // Keep user values in a ref so the returned callback stays stable.
  const userRef = useRef(user);
  userRef.current = user;

  // Stable ref to the notify fn — deps change won't recreate it.
  const notifyRef = useRef(null);
  if (!notifyRef.current) {
    notifyRef.current = (docs) => {
      const { role } = userRef.current;

      const newP = docs.filter(isSecurityActionablePass).length;
      if (newP > prevPendingP.current && role === ROLES.SECURITY) {
        sendNotif('Новый пропуск', 'Требует рассмотрения', 'pass');
        playAlert('pass');
      }
      prevPendingP.current = newP;

      const newT = docs.filter(r => r.type === 'tech' && r.status === 'pending').length;
      if (newT > prevPendingT.current && canManageRequests(role)) {
        sendNotif('Техзаявка', 'Новая заявка в техслужбу', 'tech');
        playAlert('tech');
      }
      prevPendingT.current = newT;
    };
  }

  return notifyRef.current;
}
