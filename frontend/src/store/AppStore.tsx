/**
 * AppStore - selector-based bounded-context store.
 *
 * Domains stay split into explicit slices/reducers, but the UI reads them through
 * selector hooks over a single store context instead of a deep provider chain.
 */

import { useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  StoreContext,
  DispatchContext,
  type AppStoreApi,
  type AppStoreSnapshot,
} from './boundedContexts/contexts';
import { useBoundedDomainStates } from './boundedContexts/useDomainStates';
import { useStoreActions } from './boundedContexts/useStoreActions';
import { A } from './storeActions';
import type { AppUser } from './slices/usersSlice';
import type { Car } from './slices/garageSlice';
import { INITIAL_REQUESTS, INITIAL_HISTORY } from './slices/requestsSlice';
import { INITIAL_CHAT, INITIAL_CHAT_LAST_SEEN } from './slices/chatSlice';
import { INITIAL_USERS, INITIAL_PHONE_DB, INITIAL_AVATARS } from './slices/usersSlice';
import { INITIAL_PERMS, INITIAL_TEMPLATES } from './slices/permsSlice';
import { INITIAL_BLACKLIST } from './slices/blacklistSlice';
import { INITIAL_GARAGE } from './slices/garageSlice';

export { A };

const EMPTY_STATE: AppStoreSnapshot = {
  reqState: { requests: INITIAL_REQUESTS, history: INITIAL_HISTORY },
  chatState: { chat: INITIAL_CHAT, chatLastSeen: INITIAL_CHAT_LAST_SEEN },
  usersState: { users: INITIAL_USERS, phoneDb: INITIAL_PHONE_DB, avatars: INITIAL_AVATARS },
  permsState: { perms: INITIAL_PERMS, templates: INITIAL_TEMPLATES },
  blacklistState: { blacklist: INITIAL_BLACKLIST },
  garageState: { garage: INITIAL_GARAGE },
};

const EMPTY_STORE: AppStoreApi = {
  getState: () => EMPTY_STATE,
  subscribe: () => () => {},
};

type AppDispatch = ReturnType<typeof useBoundedDomainStates>['dispatch'];

function createAppStore(initialState: AppStoreSnapshot): AppStoreApi & {
  setState: (nextState: AppStoreSnapshot) => void;
} {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState: (nextState) => {
      const hasChanged =
        state.reqState !== nextState.reqState ||
        state.chatState !== nextState.chatState ||
        state.usersState !== nextState.usersState ||
        state.permsState !== nextState.permsState ||
        state.blacklistState !== nextState.blacklistState ||
        state.garageState !== nextState.garageState;

      state = nextState;
      if (hasChanged) listeners.forEach((listener) => listener());
    },
  };
}

function useAppStoreSelector<T>(selector: (state: AppStoreSnapshot) => T): T {
  const store = useContext(StoreContext) ?? EMPTY_STORE;

  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(EMPTY_STATE),
  );
}

export function AppProvider({ children }) {
  const bounded = useBoundedDomainStates() as AppStoreSnapshot & {
    dispatch: AppDispatch;
  };
  const {
    dispatch,
    reqState,
    chatState,
    usersState,
    permsState,
    blacklistState,
    garageState,
  } = bounded;

  const storeRef = useRef<(AppStoreApi & { setState: (nextState: AppStoreSnapshot) => void }) | null>(null);

  if (!storeRef.current) {
    storeRef.current = createAppStore({
      reqState,
      chatState,
      usersState,
      permsState,
      blacklistState,
      garageState,
    });
  }

  useLayoutEffect(() => {
    storeRef.current?.setState({
      reqState,
      chatState,
      usersState,
      permsState,
      blacklistState,
      garageState,
    });

    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as Window & { __APP_STORE__?: unknown }).__APP_STORE__ = storeRef.current;
    }
  }, [reqState, chatState, usersState, permsState, blacklistState, garageState]);

  return (
    <StoreContext.Provider value={storeRef.current}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StoreContext.Provider>
  );
}

export function useAppDispatch() { return useContext(DispatchContext); }

export function useRequests() { return useAppStoreSelector((state) => state.reqState.requests); }
export function useChat() { return useAppStoreSelector((state) => state.chatState); }
export function useUsers(): { users: Record<string, AppUser>; phoneDb: Record<string, AppUser> } {
  const c = useAppStoreSelector((state) => state.usersState);
  return { users: c?.users ?? {} as Record<string, AppUser>, phoneDb: c?.phoneDb ?? {} as Record<string, AppUser> };
}
export function useAvatar(uid: string): string | null {
  return useAppStoreSelector((state) => state.usersState.avatars?.[uid] || state.usersState.users?.[uid]?.avatar || null);
}
export function usePerms(uid) { return useAppStoreSelector((state) => state.permsState.perms?.[uid] || { visitors: [], workers: [] }); }
export function useTemplates(uid) { return useAppStoreSelector((state) => state.permsState.templates?.[uid] || []); }
export function useRequestHistory(reqId) { return useAppStoreSelector((state) => state.reqState.history?.[reqId] || []); }
export function useBlacklist() { return useAppStoreSelector((state) => state.blacklistState.blacklist ?? []); }
export function useGarage(uid: string): Car[] { return useAppStoreSelector((state) => state.garageState.garage?.[uid] ?? []); }

export function useAllPerms() { return useAppStoreSelector((state) => state.permsState.perms || {}); }
export function useAllGarage() { return useAppStoreSelector((state) => state.garageState.garage ?? {}); }

export function useActions() {
  return useStoreActions();
}
