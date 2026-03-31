/**
 * AppStore.jsx — FIX [ARCH-2]: разбит на 6 независимых контекстов по доменам.
 *
 * ПРОБЛЕМА: Единый AppStateContext означал, что любой dispatch (например, новое
 * сообщение чата) перерендеривал ВСЕ компоненты, подписанные на стор — даже те,
 * которые работают только с заявками или пользователями.
 *
 * РЕШЕНИЕ: Каждый домен — отдельный контекст + отдельный useReducer.
 * Компонент, подписанный только на useRequests(), НЕ перерендерится при dispatch
 * чат-события. React сравнивает ссылки контекстов независимо.
 *
 * Контексты:
 *   RequestsContext  — requests + history
 *   ChatContext      — chat + chatLastSeen
 *   UsersContext     — users + phoneDb + avatars
 *   PermsContext     — perms + templates
 *   BlacklistContext — blacklist
 *   GarageContext    — garage
 *   DispatchContext  — единый dispatch (стабилен — не вызывает ре-рендер)
 *
 * Публичный API (хуки) полностью обратно совместим — ни один импорт не изменился.
 */

import { createContext, useContext, useReducer, useEffect, useMemo, useRef } from 'react';
import { sendNotif } from '../utils.js';
import { isLiveMode } from '../config/runtimeMode.js';
import {
  setStatusWithHistory,
  arriveWithHistory,
  approveAndArriveWithHistory,
} from '../domain/requestWorkflow';
import {
  REQUEST_SET_STATUS,
  REQUEST_ARRIVE,
  HISTORY_ADD,
} from './requestActionTypes';

import { requestsReducer, INITIAL_REQUESTS, INITIAL_HISTORY }                           from './slices/requestsSlice';
import { chatReducer,     INITIAL_CHAT,     INITIAL_CHAT_LAST_SEEN }                    from './slices/chatSlice';
import { usersReducer,    INITIAL_USERS,    INITIAL_PHONE_DB, INITIAL_AVATARS } from './slices/usersSlice';
import { permsReducer,    INITIAL_PERMS,    INITIAL_TEMPLATES }                         from './slices/permsSlice';
import { blacklistReducer, INITIAL_BLACKLIST }                                          from './slices/blacklistSlice';
import { garageReducer,   INITIAL_GARAGE }                                              from './slices/garageSlice';

// FIX [A4]: persistence вынесена в отдельный модуль
import {
  loadFromLS,
  saveRequests, saveChat, saveUsers, savePerms, saveBlacklist, saveGarage,
} from './persistence/localStorage';

// ─── Action types (публичный экспорт не изменился) ────────────────────────────

export const A = {
  REQUEST_ADD: 'REQUEST_ADD', REQUEST_UPDATE: 'REQUEST_UPDATE', REQUEST_DELETE: 'REQUEST_DELETE',
  REQUEST_SET_STATUS, REQUEST_ARRIVE,
  REQUESTS_SET_ALL: 'REQUESTS_SET_ALL', REQUEST_ACTIVATE_SCHEDULED: 'REQUEST_ACTIVATE_SCHEDULED',
  HISTORY_ADD,
  CHAT_SEND: 'CHAT_SEND', CHAT_SET_ALL: 'CHAT_SET_ALL', CHAT_MARK_SEEN: 'CHAT_MARK_SEEN',
  CHAT_UPDATE_MESSAGE: 'CHAT_UPDATE_MESSAGE', CHAT_DELETE_MESSAGE: 'CHAT_DELETE_MESSAGE',
  USER_ADD: 'USER_ADD', USER_UPDATE: 'USER_UPDATE', USER_DELETE: 'USER_DELETE', USERS_SET_ALL: 'USERS_SET_ALL',
  AVATAR_SET: 'AVATAR_SET', AVATAR_DELETE: 'AVATAR_DELETE',
  PERMS_SET: 'PERMS_SET', TEMPLATE_ADD: 'TEMPLATE_ADD', TEMPLATE_DELETE: 'TEMPLATE_DELETE', TEMPLATES_SET: 'TEMPLATES_SET',
  BLACKLIST_ADD: 'BLACKLIST_ADD', BLACKLIST_REMOVE: 'BLACKLIST_REMOVE', BLACKLIST_SET_ALL: 'BLACKLIST_SET_ALL',
  GARAGE_ADD_CAR: 'GARAGE_ADD_CAR', GARAGE_UPDATE_CAR: 'GARAGE_UPDATE_CAR', GARAGE_DELETE_CAR: 'GARAGE_DELETE_CAR', GARAGE_SET: 'GARAGE_SET',
};

// ─── Группировка actions по доменам ──────────────────────────────────────────

const REQUESTS_ACTIONS  = new Set(['REQUEST_ADD','REQUEST_UPDATE','REQUEST_DELETE','REQUEST_SET_STATUS','REQUEST_ARRIVE','REQUESTS_SET_ALL','REQUEST_ACTIVATE_SCHEDULED','HISTORY_ADD']);
const CHAT_ACTIONS      = new Set(['CHAT_SEND','CHAT_SET_ALL','CHAT_MARK_SEEN','CHAT_UPDATE_MESSAGE','CHAT_DELETE_MESSAGE']);
const USERS_ACTIONS     = new Set(['USER_ADD','USER_UPDATE','USER_DELETE','USERS_SET_ALL','AVATAR_SET','AVATAR_DELETE']);
const PERMS_ACTIONS     = new Set(['PERMS_SET','TEMPLATE_ADD','TEMPLATE_DELETE','TEMPLATES_SET']);
const BLACKLIST_ACTIONS = new Set(['BLACKLIST_ADD','BLACKLIST_REMOVE','BLACKLIST_SET_ALL']);
const GARAGE_ACTIONS    = new Set(['GARAGE_ADD_CAR','GARAGE_UPDATE_CAR','GARAGE_DELETE_CAR','GARAGE_SET']);

// ─── Слайс-редьюсеры адаптированы под локальный стейт ────────────────────────
// Каждый слайс-редьюсер ожидает весь appState, но мы передаём только нужную часть.
// Создаём обёртки, которые работают с локальным стейтом слайса.

function requestsSliceReducer(state, action) {
  // requestsReducer ожидает { requests, history, ...rest }, возвращает полный стейт
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

// ─── FIX [A4]: persistence вынесена в store/persistence/localStorage.js ──────

// ─── FIX [ARCH-2]: Разбитые контексты ────────────────────────────────────────

const RequestsContext  = createContext(null);
const ChatContext      = createContext(null);
const UsersContext     = createContext(null);
const PermsContext     = createContext(null);
const BlacklistContext = createContext(null);
const GarageContext    = createContext(null);
// Единый диспатч — стабильная ссылка, не вызывает ре-рендер подписчиков
const DispatchContext  = createContext(null);
let hasWarnedUseAppState = false;

// FIX [AUDIT-2 #9]: useDebouncedSave ВЫНЕСЕН за пределы AppProvider.
// Ранее была объявлена внутри — нарушение Rules of Hooks (React не видит top-level).
function useDebouncedSave(state, saveFn, enabled) {
  const timer = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; saveFn(state); }, 500);
    return () => clearTimeout(timer.current);
  }, [state, saveFn, enabled]);
}

// ─── AppProvider ─────────────────────────────────────────────────────────────

export function AppProvider({ children }) {
  const saved = useMemo(() => loadFromLS(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [reqState,  reqDispatch]  = useReducer(requestsSliceReducer,  null, () => ({
    requests: saved?.requests ?? INITIAL_REQUESTS,
    history:  saved?.history  ?? INITIAL_HISTORY,
  }));
  const [chatState, chatDispatch] = useReducer(chatSliceReducer, null, () => ({
    chat:         saved?.chat         ?? INITIAL_CHAT,
    chatLastSeen: saved?.chatLastSeen ?? INITIAL_CHAT_LAST_SEEN,
  }));
  const [usersState, usersDispatch] = useReducer(usersSliceReducer, null, () => ({
    users:   saved?.users   ?? INITIAL_USERS,
    phoneDb: saved?.phoneDb ?? INITIAL_PHONE_DB,
    avatars: saved?.avatars ?? INITIAL_AVATARS,
  }));
  const [permsState, permsDispatch] = useReducer(permsSliceReducer, null, () => ({
    perms:     saved?.perms     ?? INITIAL_PERMS,
    templates: saved?.templates ?? INITIAL_TEMPLATES,
  }));
  const [blacklist, blacklistDispatch] = useReducer(blacklistReducer, null, () => ({
    blacklist: saved?.blacklist ?? INITIAL_BLACKLIST,
  }));
  const [garage, garageDispatch] = useReducer(garageReducer, null, () => ({
    garage: saved?.garage ?? INITIAL_GARAGE,
  }));

  // Единый диспатч: маршрутизирует action в нужный слайс-диспатч
  // FIX [ARCH]: useReducer dispatch functions гарантированно стабильны в React.
  // Явно перечисляем их в deps вместо eslint-disable — намерение прозрачно.
  const dispatch = useMemo(() => (action) => {
    if (REQUESTS_ACTIONS.has(action.type))  return reqDispatch(action);
    if (CHAT_ACTIONS.has(action.type))      return chatDispatch(action);
    if (USERS_ACTIONS.has(action.type))     return usersDispatch(action);
    if (PERMS_ACTIONS.has(action.type))     return permsDispatch(action);
    if (BLACKLIST_ACTIONS.has(action.type)) return blacklistDispatch(action);
    if (GARAGE_ACTIONS.has(action.type))    return garageDispatch(action);
  }, [reqDispatch, chatDispatch, usersDispatch, permsDispatch, blacklistDispatch, garageDispatch]);

  // FIX [P2]: Per-slice saving with hook moved outside component
  const _notLive = !isLiveMode();

  useDebouncedSave(reqState,   saveRequests,  _notLive);
  useDebouncedSave(chatState,  saveChat,      _notLive);
  useDebouncedSave(usersState, saveUsers,     _notLive);
  useDebouncedSave(permsState, savePerms,     _notLive);
  useDebouncedSave(blacklist,  saveBlacklist, _notLive);
  useDebouncedSave(garage,     saveGarage,    _notLive);

  return (
    <DispatchContext.Provider value={dispatch}>
      <RequestsContext.Provider value={reqState}>
        <ChatContext.Provider value={chatState}>
          <UsersContext.Provider value={usersState}>
            <PermsContext.Provider value={permsState}>
              <BlacklistContext.Provider value={blacklist.blacklist ?? []}>
                <GarageContext.Provider value={garage.garage ?? {}}>
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

// ─── Публичные хуки (API не изменился) ───────────────────────────────────────

// FIX [AUDIT-3 #12]: useAppState() помечен deprecated.
// В dev/prod логируем предупреждение, но не роняем приложение для безопасной миграции.
/** @deprecated Используй: useRequests(), useChat(), useUsers(), usePerms(), useBlacklist(), useGarage() */
export function useAppState() {
  if (!hasWarnedUseAppState) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[AppStore] useAppState() deprecated in production. ' +
        'Use granular hooks: useRequests(), useChat(), useUsers(), usePerms(), useBlacklist(), useGarage()',
      );
    }
    console.warn(
      '[AppStore] useAppState() DEPRECATED — subscribes to ALL 6 contexts causing re-renders. ' +
      'Use: useRequests(), useChat(), useUsers(), usePerms(), useBlacklist(), useGarage()',
    );
    hasWarnedUseAppState = true;
  }
  const req   = useContext(RequestsContext);
  const chat  = useContext(ChatContext);
  const users = useContext(UsersContext);
  const perms = useContext(PermsContext);
  const bl    = useContext(BlacklistContext);
  const gr    = useContext(GarageContext);
  return useMemo(
    () => ({ ...req, ...chat, ...users, ...perms, blacklist: bl, garage: gr }),
    [req, chat, users, perms, bl, gr],
  );
}
export function useAppDispatch()        { return useContext(DispatchContext); }

// Оптимизированные хуки — подписываются только на нужный контекст
export function useRequests()           { return useContext(RequestsContext)?.requests || []; }
export function useChat()               { return useContext(ChatContext) || { chat: [], unreadByUid: {}, chatLastSeen: {} }; }
export function useUsers()              { const c = useContext(UsersContext) || { users: {}, phoneDb: {}, avatars: {} }; return { users: c.users || {}, phoneDb: c.phoneDb || {} }; }
export function useAvatar(uid)          { const c = useContext(UsersContext) || { avatars: {}, users: {} }; return c.avatars?.[uid] || c.users?.[uid]?.avatar || null; }
export function usePerms(uid)           { return useContext(PermsContext)?.perms?.[uid]     || { visitors: [], workers: [] }; }
export function useTemplates(uid)       { return useContext(PermsContext)?.templates?.[uid] || []; }
export function useRequestHistory(reqId){ return useContext(RequestsContext)?.history?.[reqId] || []; }
export function useBlacklist()          { return useContext(BlacklistContext) || []; }
export function useGarage(uid)          { return (useContext(GarageContext) ?? {})[uid] || []; }

// Специализированные хуки для компонентов, которым нужен весь объект perms/garage
// Подписываются только на свой контекст — не перерендерятся от чата или заявок
export function useAllPerms()           { return useContext(PermsContext)?.perms || {}; }
export function useAllGarage()          { return useContext(GarageContext) ?? {}; }

// ─── useActions — стабильный объект действий ─────────────────────────────────

export function useActions() {
  const dispatch = useContext(DispatchContext) || (() => {});

  return useMemo(() => ({
    // ── Заявки
    addRequest:        (req)                => dispatch({ type: A.REQUEST_ADD,                request: req }),
    updateRequest:     (id, patch)          => dispatch({ type: A.REQUEST_UPDATE,             id, patch }),
    deleteRequest:     (id)                 => dispatch({ type: A.REQUEST_DELETE,             id }),
    setAllRequests:    (requests)           => dispatch({ type: A.REQUESTS_SET_ALL,           requests }),
    // FIX [ARCH]: передаём now — reducer остаётся чистой функцией
    activateScheduled: ()                   => dispatch({ type: A.REQUEST_ACTIVATE_SCHEDULED, now: Date.now() }),

    approveRequest: (id, byName, byRole) => {
      setStatusWithHistory(dispatch, id, 'approved', 'Допуск разрешён', byName, byRole);
      sendNotif('Пропуск одобрен', byName + ' разрешил допуск', 'approved-' + id);
    },
    rejectRequest: (id, byName, byRole) => {
      setStatusWithHistory(dispatch, id, 'rejected', 'Отказано', byName, byRole);
      sendNotif('Пропуск отклонён', byName + ' отказал в допуске', 'rejected-' + id);
    },
    acceptRequest:    (id, byName, byRole) => setStatusWithHistory(dispatch, id, 'accepted', 'Принято в работу', byName, byRole),
    arriveRequest:    (id, byName, byRole) => arriveWithHistory(dispatch, id, byName, byRole),
    approveAndArrive: (id, byName, byRole) => approveAndArriveWithHistory(dispatch, id, byName, byRole),

    // ── Чат
    sendMessage:    (msg)       => dispatch({ type: A.CHAT_SEND,           message: msg }),
    setAllMessages: (msgs)      => dispatch({ type: A.CHAT_SET_ALL,        messages: msgs }),
    // FIX [ARCH]: передаём at в action — reducer остаётся чистой функцией
    markChatSeen:   (uid)       => dispatch({ type: A.CHAT_MARK_SEEN,      uid, at: Date.now() }),
    updateMessage:  (id, patch) => dispatch({ type: A.CHAT_UPDATE_MESSAGE, id, patch }),
    deleteMessage:  (id)        => dispatch({ type: A.CHAT_DELETE_MESSAGE, id }),

    // ── Пользователи
    addUser:     (user)        => dispatch({ type: A.USER_ADD,      user }),
    updateUser:  (uid, p, old) => dispatch({ type: A.USER_UPDATE,   uid, patch: p, oldPhone: old }),
    deleteUser:  (uid)         => dispatch({ type: A.USER_DELETE,   uid }),
    setAllUsers: (users)       => dispatch({ type: A.USERS_SET_ALL, users }),

    // ── Аватарки
    setAvatar:    (uid, avatar) => dispatch({ type: A.AVATAR_SET,    uid, avatar }),
    deleteAvatar: (uid)         => dispatch({ type: A.AVATAR_DELETE, uid }),

    // ── Разрешения и шаблоны
    setPerms:       (uid, perms)     => dispatch({ type: A.PERMS_SET,       uid, perms }),
    addTemplate:    (uid, template)  => dispatch({ type: A.TEMPLATE_ADD,    uid, template }),
    deleteTemplate: (uid, id)        => dispatch({ type: A.TEMPLATE_DELETE, uid, id }),
    setTemplates:   (uid, templates) => dispatch({ type: A.TEMPLATES_SET,   uid, templates }),

    // ── Чёрный список
    addToBlacklist:      (entry)   => dispatch({ type: A.BLACKLIST_ADD,     entry }),
    removeFromBlacklist: (id)      => dispatch({ type: A.BLACKLIST_REMOVE,  id }),
    setBlacklist:        (entries) => dispatch({ type: A.BLACKLIST_SET_ALL, entries }),

    // ── Гараж
    addGarageCar:    (uid, car)          => dispatch({ type: A.GARAGE_ADD_CAR,    uid, car }),
    updateGarageCar: (uid, carId, patch) => dispatch({ type: A.GARAGE_UPDATE_CAR, uid, carId, patch }),
    deleteGarageCar: (uid, carId)        => dispatch({ type: A.GARAGE_DELETE_CAR, uid, carId }),
    setGarage:       (uid, cars)         => dispatch({ type: A.GARAGE_SET,        uid, cars }),
  }), [dispatch]);
}
