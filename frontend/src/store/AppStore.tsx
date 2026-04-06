/**
 * AppStore — bounded-context composition root.
 *
 * ЦЕЛЬ: глубокая модульность стора.
 * Каждый домен (requests/chat/users/perms/blacklist/garage) изолирован и
 * подключается в единой точке композиции, а роутинг action-ов вынесен в
 * registry bounded contexts.
 */

import { useContext } from 'react';
import {
  AppStateContext,
  DispatchContext,
} from './boundedContexts/contexts';
import { useBoundedDomainStates } from './boundedContexts/useDomainStates';
import { useStoreActions } from './boundedContexts/useStoreActions';
import { A } from './storeActions';
import type { AppUser } from './slices/usersSlice';
import type { Car } from './slices/garageSlice';

export { A };

export function AppProvider({ children }) {
  const {
    dispatch,
    appState,
    blacklistValue,
    garageValue,
  } = useBoundedDomainStates();

  return (
    <DispatchContext.Provider value={dispatch}>
      <AppStateContext.Provider value={{ ...appState, blacklistValue, garageValue }}>
        {children}
      </AppStateContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useAppDispatch() { return useContext(DispatchContext); }

export function useRequests() { return useContext(AppStateContext)?.reqState?.requests || []; }
export function useChat() { return useContext(AppStateContext)?.chatState || { chat: [], unreadByUid: {}, chatLastSeen: {} }; }
export function useUsers(): { users: Record<string, AppUser>; phoneDb: Record<string, AppUser> } {
  const c = useContext(AppStateContext)?.usersState;
  return { users: c?.users ?? {} as Record<string, AppUser>, phoneDb: c?.phoneDb ?? {} as Record<string, AppUser> };
}
export function useAvatar(uid: string): string | null {
  const c = useContext(AppStateContext)?.usersState;
  return c?.avatars?.[uid] || c?.users?.[uid]?.avatar || null;
}
export function usePerms(uid) { return useContext(AppStateContext)?.permsState?.perms?.[uid] || { visitors: [], workers: [] }; }
export function useTemplates(uid) { return useContext(AppStateContext)?.permsState?.templates?.[uid] || []; }
export function useRequestHistory(reqId) { return useContext(AppStateContext)?.reqState?.history?.[reqId] || []; }
export function useBlacklist() { return useContext(AppStateContext)?.blacklistValue || []; }
export function useGarage(uid: string): Car[] { return useContext(AppStateContext)?.garageValue?.[uid] ?? []; }

export function useAllPerms() { return useContext(AppStateContext)?.permsState?.perms || {}; }
export function useAllGarage() { return useContext(AppStateContext)?.garageValue ?? {}; }

export function useActions() {
  return useStoreActions();
}
