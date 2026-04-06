import { useContext, useMemo, useCallback } from 'react';
import {
  setStatusWithHistory,
  arriveWithHistory,
  approveAndArriveWithHistory,
} from '../../domain/requestWorkflow';
import { DispatchContext } from './contexts';
import { A } from '../storeActions';
import { emitUxMetric, UX_METRICS } from '../../utils/telemetryContract';

export function useStoreActions() {
  const dispatch = useContext(DispatchContext);

  const dispatchWithMetric = useCallback((actionName, action) => {
    if (!dispatch) return;
    try {
      const out = dispatch(action);
      emitUxMetric(UX_METRICS.ACTION_SUCCESS, { action: actionName });
      return out;
    } catch (error) {
      emitUxMetric(UX_METRICS.ACTION_FAILURE, { action: actionName, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [dispatch]);

  return useMemo(() => ({
    addRequest:        (req)                => dispatchWithMetric('REQUEST_ADD', { type: A.REQUEST_ADD,                request: req }),
    updateRequest:     (id, patch)          => dispatchWithMetric('REQUEST_UPDATE', { type: A.REQUEST_UPDATE,             id, patch }),
    deleteRequest:     (id)                 => dispatchWithMetric('REQUEST_DELETE', { type: A.REQUEST_DELETE,             id }),
    setAllRequests:    (requests)           => dispatchWithMetric('REQUESTS_SET_ALL', { type: A.REQUESTS_SET_ALL,           requests }),
    activateScheduled: ()                   => dispatchWithMetric('REQUEST_ACTIVATE_SCHEDULED', { type: A.REQUEST_ACTIVATE_SCHEDULED, now: Date.now() }),

    approveRequest: (id, byName, byRole) =>
      setStatusWithHistory((a) => dispatchWithMetric('REQUEST_SET_STATUS', a), id, 'approved', 'Допуск разрешён', byName, byRole),
    rejectRequest: (id, byName, byRole) =>
      setStatusWithHistory((a) => dispatchWithMetric('REQUEST_SET_STATUS', a), id, 'rejected', 'Отказано', byName, byRole),
    acceptRequest:    (id, byName, byRole) => setStatusWithHistory((a) => dispatchWithMetric('REQUEST_SET_STATUS', a), id, 'accepted', 'Принято в работу', byName, byRole),
    arriveRequest:    (id, byName, byRole) => arriveWithHistory((a) => dispatchWithMetric('REQUEST_ARRIVE', a), id, byName, byRole),
    approveAndArrive: (id, byName, byRole) => approveAndArriveWithHistory((a) => dispatchWithMetric('REQUEST_SET_STATUS', a), id, byName, byRole),

    sendMessage:    (msg)       => dispatchWithMetric('CHAT_SEND', { type: A.CHAT_SEND,           message: msg }),
    setAllMessages: (msgs)      => dispatchWithMetric('CHAT_SET_ALL', { type: A.CHAT_SET_ALL,        messages: msgs }),
    markChatSeen:   (uid)       => dispatchWithMetric('CHAT_MARK_SEEN', { type: A.CHAT_MARK_SEEN,      uid, at: Date.now() }),
    updateMessage:  (id, patch) => dispatchWithMetric('CHAT_UPDATE_MESSAGE', { type: A.CHAT_UPDATE_MESSAGE, id, patch }),
    deleteMessage:  (id)        => dispatchWithMetric('CHAT_DELETE_MESSAGE', { type: A.CHAT_DELETE_MESSAGE, id }),

    addUser:     (user)        => dispatchWithMetric('USER_ADD', { type: A.USER_ADD,      user }),
    updateUser:  (uid, p, old) => dispatchWithMetric('USER_UPDATE', { type: A.USER_UPDATE,   uid, patch: p, oldPhone: old }),
    deleteUser:  (uid)         => dispatchWithMetric('USER_DELETE', { type: A.USER_DELETE,   uid }),
    setAllUsers: (users)       => dispatchWithMetric('USERS_SET_ALL', { type: A.USERS_SET_ALL, users }),

    setAvatar:    (uid, avatar) => dispatchWithMetric('AVATAR_SET', { type: A.AVATAR_SET,    uid, avatar }),
    deleteAvatar: (uid)         => dispatchWithMetric('AVATAR_DELETE', { type: A.AVATAR_DELETE, uid }),

    setPerms:       (uid, perms)     => dispatchWithMetric('PERMS_SET', { type: A.PERMS_SET,       uid, perms }),
    addTemplate:    (uid, template)  => dispatchWithMetric('TEMPLATE_ADD', { type: A.TEMPLATE_ADD,    uid, template }),
    deleteTemplate: (uid, id)        => dispatchWithMetric('TEMPLATE_DELETE', { type: A.TEMPLATE_DELETE, uid, id }),
    setTemplates:   (uid, templates) => dispatchWithMetric('TEMPLATES_SET', { type: A.TEMPLATES_SET,   uid, templates }),

    addToBlacklist:      (entry)   => dispatchWithMetric('BLACKLIST_ADD', { type: A.BLACKLIST_ADD,     entry }),
    removeFromBlacklist: (id)      => dispatchWithMetric('BLACKLIST_REMOVE', { type: A.BLACKLIST_REMOVE,  id }),
    setBlacklist:        (entries) => dispatchWithMetric('BLACKLIST_SET_ALL', { type: A.BLACKLIST_SET_ALL, entries }),

    addGarageCar:    (uid, car)          => dispatchWithMetric('GARAGE_ADD_CAR', { type: A.GARAGE_ADD_CAR,    uid, car }),
    updateGarageCar: (uid, carId, patch) => dispatchWithMetric('GARAGE_UPDATE_CAR', { type: A.GARAGE_UPDATE_CAR, uid, carId, patch }),
    deleteGarageCar: (uid, carId)        => dispatchWithMetric('GARAGE_DELETE_CAR', { type: A.GARAGE_DELETE_CAR, uid, carId }),
    setGarage:       (uid, cars)         => dispatchWithMetric('GARAGE_SET', { type: A.GARAGE_SET,        uid, cars }),
  }), [dispatchWithMetric]);
}
