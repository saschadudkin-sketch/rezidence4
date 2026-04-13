import { useRef } from 'react';
import { canManageRequests } from '../domain/permissions';
import { ROLES } from '../domain/permissions';
import { isSecurityActionablePass } from '../domain/passLifecycle';
import { sendNotif, playAlert } from '../utils';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';

type NotifierUser = Pick<AppUser, 'role'>;
type NotifyNewRequests = (docs: AppRequest[]) => void;

/**
 * useNewRequestNotifier вЂ” fires browser notifications + audio alerts when new
 * pending requests arrive via SSE. Extracted from useLiveSync (ARCH-2) so that
 * notification policy lives separately from sync infrastructure.
 *
 * Returns a stable `notify(docs)` callback that can be called from the SSE
 * onRequests handler. The callback reads the latest user values via a ref so
 * useLiveSync can call it without restarting the SSE effect.
 */
export function useNewRequestNotifier(user: NotifierUser): NotifyNewRequests {
  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;

  const notifyRef = useRef<NotifyNewRequests | null>(null);
  if (!notifyRef.current) {
    notifyRef.current = (docs: AppRequest[]) => {
      const { role } = userRef.current;

      const newP = docs.filter(isSecurityActionablePass).length;
      if (newP > prevPendingP.current && role === ROLES.SECURITY) {
        sendNotif('РќРѕРІС‹Р№ РїСЂРѕРїСѓСЃРє', 'РўСЂРµР±СѓРµС‚ СЂР°СЃСЃРјРѕС‚СЂРµРЅРёСЏ', 'pass');
        playAlert('pass');
      }
      prevPendingP.current = newP;

      const newT = docs.filter((r) => r.type === 'tech' && r.status === 'pending').length;
      if (newT > prevPendingT.current && canManageRequests(role)) {
        sendNotif('РўРµС…Р·Р°СЏРІРєР°', 'РќРѕРІР°СЏ Р·Р°СЏРІРєР° РІ С‚РµС…СЃР»СѓР¶Р±Сѓ', 'tech');
        playAlert('tech');
      }
      prevPendingT.current = newT;
    };
  }

  return notifyRef.current;
}
