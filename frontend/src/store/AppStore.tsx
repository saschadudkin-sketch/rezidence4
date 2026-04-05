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

export { A };

export function AppProvider({ children }) {
  const {
    dispatch,
    reqState,
    chatState,
    usersState,
    permsState,
    blacklistState,
    garageState,
  } = useBoundedDomainStates();

  return (
    <DispatchContext.Provider value={dispatch}>
      <RequestsContext.Provider value={reqState}>
        <ChatContext.Provider value={chatState}>
          <UsersContext.Provider value={usersState}>
            <PermsContext.Provider value={permsState}>
              <BlacklistContext.Provider value={blacklistState.blacklist ?? []}>
                <GarageContext.Provider value={garageState.garage ?? {}}>
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
export function useUsers() {
  const c = useContext(UsersContext) || { users: {}, phoneDb: {}, avatars: {} };
  return { users: c.users || {}, phoneDb: c.phoneDb || {} };
}
export function useAvatar(uid) {
  const c = useContext(UsersContext) || { avatars: {}, users: {} };
  return c.avatars?.[uid] || c.users?.[uid]?.avatar || null;
}
export function usePerms(uid) { return useContext(PermsContext)?.perms?.[uid] || { visitors: [], workers: [] }; }
export function useTemplates(uid) { return useContext(PermsContext)?.templates?.[uid] || []; }
export function useRequestHistory(reqId) { return useContext(RequestsContext)?.history?.[reqId] || []; }
export function useBlacklist() { return useContext(BlacklistContext); }
export function useGarage(uid) { return useContext(GarageContext)[uid] || []; }

export function useAllPerms() { return useContext(PermsContext)?.perms || {}; }
export function useAllGarage() { return useContext(GarageContext) ?? {}; }

export function useActions() {
  return useStoreActions();
}
