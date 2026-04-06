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
  RequestsContext,
  ChatContext,
  UsersContext,
  PermsContext,
  BlacklistContext,
  GarageContext,
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
    reqState,
    chatState,
    usersState,
    permsState,
    blacklistValue,
    garageValue,
  } = useBoundedDomainStates();

  return (
    <DispatchContext.Provider value={dispatch}>
      <RequestsContext.Provider value={reqState}>
        <ChatContext.Provider value={chatState}>
          <UsersContext.Provider value={usersState}>
            <PermsContext.Provider value={permsState}>
              <BlacklistContext.Provider value={blacklistValue}>
                <GarageContext.Provider value={garageValue}>
                  {children}
                </GarageContext.Provider>
              </BlacklistContext.Provider>
            </PermsContext.Provider>
          </UsersContext.Provider>
        </ChatContext.Provider>
      </RequestsContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useAppDispatch() { return useContext(DispatchContext); }

export function useRequests() { return useContext(RequestsContext)?.requests || []; }
export function useChat() { return useContext(ChatContext) || { chat: [], unreadByUid: {}, chatLastSeen: {} }; }
export function useUsers(): { users: Record<string, AppUser>; phoneDb: Record<string, AppUser> } {
  const c = useContext(UsersContext);
  return { users: c?.users ?? {} as Record<string, AppUser>, phoneDb: c?.phoneDb ?? {} as Record<string, AppUser> };
}
export function useAvatar(uid: string): string | null {
  const c = useContext(UsersContext);
  return c?.avatars?.[uid] || c?.users?.[uid]?.avatar || null;
}
export function usePerms(uid) { return useContext(PermsContext)?.perms?.[uid] || { visitors: [], workers: [] }; }
export function useTemplates(uid) { return useContext(PermsContext)?.templates?.[uid] || []; }
export function useRequestHistory(reqId) { return useContext(RequestsContext)?.history?.[reqId] || []; }
export function useBlacklist() { return useContext(BlacklistContext); }
export function useGarage(uid: string): Car[] { return useContext(GarageContext)?.[uid] ?? []; }

export function useAllPerms() { return useContext(PermsContext)?.perms || {}; }
export function useAllGarage() { return useContext(GarageContext) ?? {}; }

export function useActions() {
  return useStoreActions();
}
