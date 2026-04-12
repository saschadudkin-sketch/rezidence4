import { useReducer, useState, useCallback, useEffect } from 'react';
import { isLiveMode } from '../../config/runtimeMode';
import {
  requestsReducer, INITIAL_REQUESTS, INITIAL_HISTORY,
} from '../slices/requestsSlice';
import {
  chatReducer, INITIAL_CHAT, INITIAL_CHAT_LAST_SEEN,
} from '../slices/chatSlice';
import {
  usersReducer, INITIAL_USERS, INITIAL_PHONE_DB, INITIAL_AVATARS,
} from '../slices/usersSlice';
import {
  permsReducer, INITIAL_PERMS, INITIAL_TEMPLATES,
} from '../slices/permsSlice';
import {
  blacklistReducer, INITIAL_BLACKLIST,
} from '../slices/blacklistSlice';
import {
  garageReducer, INITIAL_GARAGE,
} from '../slices/garageSlice';
import {
  loadFromLS,
  hydrateRequestMediaFromIndexedDb,
  saveRequests,
  saveChat,
  saveUsers,
  savePerms,
  saveBlacklist,
  saveGarage,
} from '../persistence/localStorage';
import { useDebouncedSave } from '../useDebouncedSave';
import { routeDomainDispatch } from './domainRegistry';
import { A } from '../storeActions';
import type { AppStoreAction } from './contexts';

function requestsSliceReducer(state, action) {
  const full = requestsReducer({ requests: state.requests, history: state.history }, action);
  return { requests: full.requests, history: full.history };
}

function chatSliceReducer(state, action) {
  const full = chatReducer({ chat: state.chat, chatLastSeen: state.chatLastSeen }, action);
  return { chat: full.chat, chatLastSeen: full.chatLastSeen };
}

function usersSliceReducer(state, action) {
  const full = usersReducer({ users: state.users, phoneDb: state.phoneDb, avatars: state.avatars }, action);
  return { users: full.users, phoneDb: full.phoneDb, avatars: full.avatars };
}

function permsSliceReducer(state, action) {
  const full = permsReducer({ perms: state.perms, templates: state.templates }, action);
  return { perms: full.perms, templates: full.templates };
}

export function useBoundedDomainStates() {
  const isDemoMode = !isLiveMode();
  // FIX [MED-2]: убран бессмысленный алиас _saved → saved.
  // Префикс _ сигнализировал "не используется", но переменная сразу же копировалась.
  const [saved] = useState(() => (isDemoMode ? loadFromLS({ criticalOnly: true }) : null));

  const [reqState, requestsDispatch] = useReducer(requestsSliceReducer, null, () => ({
    requests: saved?.requests ?? INITIAL_REQUESTS,
    history: saved?.history ?? INITIAL_HISTORY,
  }));
  const [chatState, chatDispatch] = useReducer(chatSliceReducer, null, () => ({
    chat: saved?.chat ?? INITIAL_CHAT,
    chatLastSeen: saved?.chatLastSeen ?? INITIAL_CHAT_LAST_SEEN,
  }));
  const [usersState, usersDispatch] = useReducer(usersSliceReducer, null, () => ({
    users: saved?.users ?? INITIAL_USERS,
    phoneDb: saved?.phoneDb ?? INITIAL_PHONE_DB,
    avatars: saved?.avatars ?? INITIAL_AVATARS,
  }));
  const [permsState, permsDispatch] = useReducer(permsSliceReducer, null, () => ({
    perms: saved?.perms ?? INITIAL_PERMS,
    templates: saved?.templates ?? INITIAL_TEMPLATES,
  }));
  const [blacklistState, blacklistDispatch] = useReducer(blacklistReducer, null, () => ({
    blacklist: saved?.blacklist ?? INITIAL_BLACKLIST,
  }));
  const [garageState, garageDispatch] = useReducer(garageReducer, null, () => ({
    garage: saved?.garage ?? INITIAL_GARAGE,
  }));

  const dispatch = useCallback((action: AppStoreAction) => routeDomainDispatch(action, {
    requests: requestsDispatch,
    chat: chatDispatch,
    users: usersDispatch,
    perms: permsDispatch,
    blacklist: blacklistDispatch,
    garage: garageDispatch,
  }), []);

  useDebouncedSave(reqState, saveRequests, isDemoMode);
  useDebouncedSave(chatState, saveChat, isDemoMode);
  useDebouncedSave(usersState, saveUsers, isDemoMode);
  useDebouncedSave(permsState, savePerms, isDemoMode);
  useDebouncedSave(blacklistState, saveBlacklist, isDemoMode);
  useDebouncedSave(garageState, saveGarage, isDemoMode);

  useEffect(() => {
    if (!isDemoMode) return;

    const applyDeferredHydration = async () => {
      const full = loadFromLS();
      if (!full) return;
      if (full.requests) {
        dispatch({ type: A.REQUESTS_SET_ALL, requests: full.requests });
        const hydrated = await hydrateRequestMediaFromIndexedDb(full.requests);
        dispatch({ type: A.REQUESTS_SET_ALL, requests: hydrated });
      }
      if (full.chat) dispatch({ type: A.CHAT_SET_ALL, messages: full.chat });
      if (full.users) dispatch({ type: A.USERS_SET_ALL, users: Object.values(full.users) });
      if (full.perms) Object.entries(full.perms).forEach(([uid, perms]) => dispatch({ type: A.PERMS_SET, uid, perms }));
      if (full.templates) Object.entries(full.templates).forEach(([uid, templates]) => dispatch({ type: A.TEMPLATES_SET, uid, templates }));
      if (full.blacklist) dispatch({ type: A.BLACKLIST_SET_ALL, entries: full.blacklist });
      if (full.garage) Object.entries(full.garage).forEach(([uid, cars]) => dispatch({ type: A.GARAGE_SET, uid, cars }));
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(applyDeferredHydration, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(applyDeferredHydration, 350);
    return () => clearTimeout(t);
  }, [dispatch, isDemoMode]);

  return {
    dispatch,
    reqState,
    chatState,
    usersState,
    permsState,
    blacklistState,
    garageState,
  };
}
