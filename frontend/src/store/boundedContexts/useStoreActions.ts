import { useContext, useMemo } from 'react';
import {
  setStatusWithHistory,
  arriveWithHistory,
  approveAndArriveWithHistory,
} from '../../domain/requestWorkflow';
import { DispatchContext } from './contexts';
import { A } from '../storeActions';

export function useStoreActions() {
  const dispatch = useContext(DispatchContext) || (() => {});

  return useMemo(() => ({
    addRequest:        (req)                => dispatch({ type: A.REQUEST_ADD,                request: req }),
    updateRequest:     (id, patch)          => dispatch({ type: A.REQUEST_UPDATE,             id, patch }),
    deleteRequest:     (id)                 => dispatch({ type: A.REQUEST_DELETE,             id }),
    setAllRequests:    (requests)           => dispatch({ type: A.REQUESTS_SET_ALL,           requests }),
    activateScheduled: ()                   => dispatch({ type: A.REQUEST_ACTIVATE_SCHEDULED, now: Date.now() }),

    approveRequest: (id, byName, byRole) =>
      setStatusWithHistory(dispatch, id, 'approved', 'Допуск разрешён', byName, byRole),
    rejectRequest: (id, byName, byRole) =>
      setStatusWithHistory(dispatch, id, 'rejected', 'Отказано', byName, byRole),
    acceptRequest:    (id, byName, byRole) => setStatusWithHistory(dispatch, id, 'accepted', 'Принято в работу', byName, byRole),
    arriveRequest:    (id, byName, byRole) => arriveWithHistory(dispatch, id, byName, byRole),
    approveAndArrive: (id, byName, byRole) => approveAndArriveWithHistory(dispatch, id, byName, byRole),

    sendMessage:    (msg)       => dispatch({ type: A.CHAT_SEND,           message: msg }),
    setAllMessages: (msgs)      => dispatch({ type: A.CHAT_SET_ALL,        messages: msgs }),
    markChatSeen:   (uid)       => dispatch({ type: A.CHAT_MARK_SEEN,      uid, at: Date.now() }),
    updateMessage:  (id, patch) => dispatch({ type: A.CHAT_UPDATE_MESSAGE, id, patch }),
    deleteMessage:  (id)        => dispatch({ type: A.CHAT_DELETE_MESSAGE, id }),

    addUser:     (user)        => dispatch({ type: A.USER_ADD,      user }),
    updateUser:  (uid, p, old) => dispatch({ type: A.USER_UPDATE,   uid, patch: p, oldPhone: old }),
    deleteUser:  (uid)         => dispatch({ type: A.USER_DELETE,   uid }),
    setAllUsers: (users)       => dispatch({ type: A.USERS_SET_ALL, users }),

    setAvatar:    (uid, avatar) => dispatch({ type: A.AVATAR_SET,    uid, avatar }),
    deleteAvatar: (uid)         => dispatch({ type: A.AVATAR_DELETE, uid }),

    setPerms:       (uid, perms)     => dispatch({ type: A.PERMS_SET,       uid, perms }),
    addTemplate:    (uid, template)  => dispatch({ type: A.TEMPLATE_ADD,    uid, template }),
    deleteTemplate: (uid, id)        => dispatch({ type: A.TEMPLATE_DELETE, uid, id }),
    setTemplates:   (uid, templates) => dispatch({ type: A.TEMPLATES_SET,   uid, templates }),

    addToBlacklist:      (entry)   => dispatch({ type: A.BLACKLIST_ADD,     entry }),
    removeFromBlacklist: (id)      => dispatch({ type: A.BLACKLIST_REMOVE,  id }),
    setBlacklist:        (entries) => dispatch({ type: A.BLACKLIST_SET_ALL, entries }),

    addGarageCar:    (uid, car)          => dispatch({ type: A.GARAGE_ADD_CAR,    uid, car }),
    updateGarageCar: (uid, carId, patch) => dispatch({ type: A.GARAGE_UPDATE_CAR, uid, carId, patch }),
    deleteGarageCar: (uid, carId)        => dispatch({ type: A.GARAGE_DELETE_CAR, uid, carId }),
    setGarage:       (uid, cars)         => dispatch({ type: A.GARAGE_SET,        uid, cars }),
  }), [dispatch]);
}
