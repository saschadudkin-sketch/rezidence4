import { useRef } from 'react';
import { toast } from '../ui/Toasts';
import { isResident } from '../domain/permissions';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';

type NotifierUser = Pick<AppUser, 'uid' | 'role'>;
type NotifyStatusChange = (req: AppRequest) => void;

const STATUS_TOAST: Partial<Record<AppRequest['status'], { msg: string; type: 'info' | 'success' | 'error' }>> = {
  approved: { msg: 'РџСЂРѕРїСѓСЃРє РѕРґРѕР±СЂРµРЅ вЂ” РїРѕРєР°Р¶РёС‚Рµ QR-РєРѕРґ РѕС…СЂР°РЅРµ', type: 'success' },
  rejected: { msg: 'Р’ РїСЂРѕРїСѓСЃРєРµ РѕС‚РєР°Р·Р°РЅРѕ', type: 'error' },
  arrived: { msg: 'Р’С…РѕРґ РїРѕСЃРµС‚РёС‚РµР»СЏ РѕС‚РјРµС‡РµРЅ РѕС…СЂР°РЅРѕР№', type: 'info' },
  expired: { msg: 'РџСЂРѕРїСѓСЃРє РёСЃС‚С‘Рє', type: 'info' },
  accepted: { msg: 'Р—Р°СЏРІРєР° РїСЂРёРЅСЏС‚Р° РІ СЂР°Р±РѕС‚Сѓ', type: 'success' },
};

/**
 * useStatusChangeNotifier вЂ” shows a toast when one of the current user's requests
 * changes status via an incremental SSE update (onRequestUpdate).
 *
 * Only fires for residents (owner / tenant / contractor); staff sees all requests
 * and would be flooded with toasts on busy days.
 *
 * Returns a stable `notify(req)` callback for use in useLiveSync.
 */
export function useStatusChangeNotifier(user: NotifierUser): NotifyStatusChange {
  const prevStatusesRef = useRef(new Map<string, AppRequest['status']>());
  const userRef = useRef(user);
  userRef.current = user;

  const notifyRef = useRef<NotifyStatusChange | null>(null);
  if (!notifyRef.current) {
    notifyRef.current = (req: AppRequest) => {
      const { uid, role } = userRef.current;
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
