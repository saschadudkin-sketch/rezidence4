import { useState, useEffect, useMemo } from 'react';
import { canManageRequests } from '../constants/requestPredicates';

// O(1) lookup вместо O(n) Array.includes() в горячем useMemo
const RESIDENT_STATUS_SET = new Set(['approved', 'rejected', 'arrived', 'cancelled']);

/**
 * useNavBadges — счётчики для навигационных иконок.
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
  // BUG-7: lsVersion — триггер для пересчёта residentNewStatuses при записи в localStorage.
  // goTab() пишет в 'rz-passes-seen' → storage event → lsVersion++ → useMemo пересчитывает.
  const [lsVersion, setLsVersion] = useState(0);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'rz-passes-seen') setLsVersion(v => v + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [pendingT, pendingP] = useMemo(() => [
    requests.filter(r => r.type === 'tech' && r.status === 'pending').length,
    requests.filter(r => r.type === 'pass' && r.status === 'pending').length,
  ], [requests]);

  const lastSeen   = chatLastSeen[user.uid] || 0;
  const unreadMsgs = useMemo(
    () => chat.filter(m => m.uid !== user.uid && new Date(m.at).getTime() > lastSeen).length,
    [chat, user.uid, lastSeen],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- lsVersion intentionally triggers re-read
  const residentNewStatuses = useMemo(() => {
    void lsVersion; // trigger recalculation after onPassesSeen updates localStorage marker
    if (canManageRequests(user.role)) return 0;
    let lastSeenPassesAt = 0;
    try { lastSeenPassesAt = parseInt(localStorage.getItem('rz-passes-seen') || '0'); } catch { /* ok */ }
    return requests.filter(
      r => r.createdByUid === user.uid
        && RESIDENT_STATUS_SET.has(r.status)
        && new Date(r.createdAt).getTime() > lastSeenPassesAt,
    ).length;
  }, [requests, user.uid, user.role, lsVersion]);

  return {
    pendingT,
    pendingP,
    unreadMsgs,
    residentNewStatuses,
    blacklistCount: blacklist.length,
    onPassesSeen: () => setLsVersion(v => v + 1),
  };
}
