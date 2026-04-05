import { useRef } from 'react';
import { toast } from '../ui/Toasts';
import { isResident } from '../domain/permissions';

// Human-readable labels for each status transition shown to residents.
const STATUS_TOAST = {
  approved: { msg: 'Пропуск одобрен — покажите QR-код охране', type: 'success' },
  rejected: { msg: 'В пропуске отказано', type: 'error' },
  arrived:  { msg: 'Вход посетителя отмечен охраной', type: 'info' },
  expired:  { msg: 'Пропуск истёк', type: 'info' },
  accepted: { msg: 'Заявка принята в работу', type: 'success' },
};

/**
 * useStatusChangeNotifier — shows a toast when one of the current user's requests
 * changes status via an incremental SSE update (onRequestUpdate).
 *
 * Only fires for residents (owner / tenant / contractor); staff sees all requests
 * and would be flooded with toasts on busy days.
 *
 * Returns a stable `notify(req)` callback for use in useLiveSync.
 */
export function useStatusChangeNotifier(user) {
  // Map of reqId → last known status; used to detect transitions.
  const prevStatusesRef = useRef(new Map());
  const userRef = useRef(user);
  userRef.current = user;

  const notifyRef = useRef(null);
  if (!notifyRef.current) {
    notifyRef.current = (req) => {
      const { uid, role } = userRef.current;
      // Only notify the owner of the request, and only for resident roles.
      if (!isResident(role)) return;
      if (req.createdByUid !== uid) return;

      const prev = prevStatusesRef.current.get(req.id);
      if (prev !== undefined && prev !== req.status) {
        const t = STATUS_TOAST[req.status];
        if (t) toast(t.msg, t.type);
      }
      prevStatusesRef.current.set(req.id, req.status);
    };
  }

  return notifyRef.current;
}
