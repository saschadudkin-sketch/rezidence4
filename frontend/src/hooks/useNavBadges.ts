import { useState, useEffect, useMemo, useCallback } from 'react';
import { canManageRequests } from '../domain/permissions';
import { isSecurityActionablePass } from '../domain/passLifecycle';
import type { ChatMessage } from '../store/slices/chatSlice';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { BlacklistEntry } from '../store/slices/blacklistSlice';

// O(1) lookup вместо O(n) Array.includes() в горячем useMemo
const RESIDENT_STATUS_SET = new Set<AppRequest['status']>(['approved', 'rejected', 'arrived', 'cancelled']);

const LS_KEY = 'rz-passes-seen';

function readLastSeen() {
  try { return parseInt(localStorage.getItem(LS_KEY) || '0'); } catch { return 0; }
}

/**
 * useNavBadges — счётчики для навигационных иконок.
 *
 * A-02: refactored — заменяем lsVersion hack (void lsVersion + eslint-disable)
 * на явное состояние lastSeenPassesAt. Теперь useMemo использует его напрямую
 * без side-effect триггеров.
 *
 * Возвращает:
 *   pendingT            — кол-во новых техзаявок (для персонала)
 *   pendingP            — кол-во новых пропусков (для персонала)
 *   unreadMsgs          — непрочитанные сообщения чата
 *   residentNewStatuses — обновления статусов заявок (для жильца)
 *   blacklistCount      — кол-во записей в чёрном списке
 *   onPassesSeen        — колбэк: немедленно сбросить счётчик пропусков
 */
export function useNavBadges(
  user: AppUser,
  requests: AppRequest[],
  chat: ChatMessage[],
  chatLastSeen: Record<string, number>,
  blacklist: BlacklistEntry[],
) {
  // A-02: хранить отметку времени в state — явная зависимость useMemo без хаков
  const [lastSeenPassesAt, setLastSeenPassesAt] = useState(readLastSeen);

  // Синхронизация с другими вкладками
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setLastSeenPassesAt(parseInt(e.newValue || '0'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [pendingT, pendingP] = useMemo(() => [
    requests.filter((request) => request.type === 'tech' && request.status === 'pending').length,
    requests.filter(isSecurityActionablePass).length,
  ], [requests]);

  const lastSeen   = chatLastSeen[user.uid] || 0;
  // PERF-04: count loop instead of filter() — avoids allocating a new array on every update.
  const unreadMsgs = useMemo(() => {
    let count = 0;
    for (const message of chat) {
      if (message.uid !== user.uid && new Date(message.at).getTime() > lastSeen) count++;
    }
    return count;
  }, [chat, user.uid, lastSeen]);

  const residentNewStatuses = useMemo(() => {
    if (canManageRequests(user.role)) return 0;
    return requests.filter(
      (request) => request.createdByUid === user.uid
        && RESIDENT_STATUS_SET.has(request.status)
        && new Date(request.createdAt).getTime() > lastSeenPassesAt,
    ).length;
  }, [requests, user.uid, user.role, lastSeenPassesAt]);

  const onPassesSeen = useCallback(() => {
    const now = Date.now();
    try { localStorage.setItem(LS_KEY, String(now)); } catch { /* ok */ }
    setLastSeenPassesAt(now);
  }, []);

  return {
    pendingT,
    pendingP,
    unreadMsgs,
    residentNewStatuses,
    blacklistCount: blacklist.length,
    onPassesSeen,
  };
}
