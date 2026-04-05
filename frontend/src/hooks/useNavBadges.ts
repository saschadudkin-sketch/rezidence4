import { useState, useEffect, useMemo, useCallback } from 'react';
import { canManageRequests } from '../domain/permissions';

// O(1) lookup вместо O(n) Array.includes() в горячем useMemo
const RESIDENT_STATUS_SET = new Set(['approved', 'rejected', 'arrived', 'cancelled']);

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
export function useNavBadges(user, requests, chat, chatLastSeen, blacklist) {
  // A-02: хранить отметку времени в state — явная зависимость useMemo без хаков
  const [lastSeenPassesAt, setLastSeenPassesAt] = useState(readLastSeen);

  // Синхронизация с другими вкладками
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LS_KEY) setLastSeenPassesAt(parseInt(e.newValue || '0'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [pendingT, pendingP] = useMemo(() => [
    requests.filter(r => r.type === 'tech' && r.status === 'pending').length,
    requests.filter(r => r.type === 'pass' && r.status === 'pending').length,
  ], [requests]);

  const lastSeen   = chatLastSeen[user.uid] || 0;
  // PERF-04: count loop instead of filter() — avoids allocating a new array on every update.
  const unreadMsgs = useMemo(() => {
    let count = 0;
    for (const m of chat) {
      if (m.uid !== user.uid && new Date(m.at).getTime() > lastSeen) count++;
    }
    return count;
  }, [chat, user.uid, lastSeen]);

  const residentNewStatuses = useMemo(() => {
    if (canManageRequests(user.role)) return 0;
    return requests.filter(
      r => r.createdByUid === user.uid
        && RESIDENT_STATUS_SET.has(r.status)
        && new Date(r.createdAt).getTime() > lastSeenPassesAt,
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
