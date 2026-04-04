import { useState, useEffect, useRef, startTransition } from 'react';
import { canManageRequests } from '../domain/permissions.js';
import { ROLES } from '../domain/permissions.js';
import { sendNotif, playAlert } from '../utils.js';
import { isLiveMode, isDemoMode } from '../config/runtimeMode.js';
import { services } from '../services/providers/serviceContainer.js';
import { logger } from '../services/logger.js';

/**
 * useLiveSync — SSE-синхронизация с сервером.
 * A-15: SSE state updates wrapped in startTransition so that live data
 * updates yield to urgent user interactions (typing, taps, navigation).
 */
export function useLiveSync(user, {
  setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
  // P-02: retryKey increment triggers soft reconnect without page reload
  retryKey = 0,
  // Incremental blacklist/user SSE updates
  addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
  // PERF: Incremental request SSE updates — избегаем full REQUESTS_SET_ALL при каждом событии
  updateRequest, addRequest, deleteRequest,
}) {
  const [isLoading,   setIsLoading]   = useState(true);
  // FA-07: статус SSE-соединения для индикатора в header
  const [sseOnline, setSseOnline] = useState(true);
  // D-04: SSE достиг лимита попыток — требуется ручной retry
  const [ssePermanentError, setSsePermanentError] = useState(false);

  useEffect(() => {
    const onStatus = (e) => setSseOnline(e.detail.connected);
    const onPermanent = () => setSsePermanentError(true);
    window.addEventListener('rz:sse-status', onStatus);
    window.addEventListener('rz:sse-permanent-error', onPermanent);
    return () => {
      window.removeEventListener('rz:sse-status', onStatus);
      window.removeEventListener('rz:sse-permanent-error', onPermanent);
    };
  }, []);

  // Стабильный ref — колбэки обновляются без перезапуска эффекта
  const callbacksRef = useRef({});
  // Стабильный ref — обновляем на каждом рендере без перезапуска эффекта.
  // Это намеренный паттерн: колбэки всегда актуальны, SSE-эффект не рестартует.
  callbacksRef.current = {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
    updateRequest, addRequest, deleteRequest,
  };

  // A-05: refs live here — not in Dashboard — Dashboard had no business owning them
  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);

  // FIX: флаг-ref, чтобы setIsLoading(false) вызвался ровно один раз.
  // Без него: setAllRequests-обёртка И onRequests оба вызывали setIsLoading(false)
  // при первом пакете данных → двойной state update (безвредный в React 18, но лишний).
  const loadingClearedRef = useRef(false);
  const clearLoading = () => {
    if (!loadingClearedRef.current) {
      loadingClearedRef.current = true;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLiveMode() && !isDemoMode()) {
      setIsLoading(false);
      return;
    }

    // Сброс флага при перезапуске эффекта (смена uid/role или soft retry)
    loadingClearedRef.current = false;
    setIsLoading(true);

    let cleanupFn = null;
    let cancelled  = false;

    Promise.resolve(services.liveData.startSync({
      userUid:        user.uid,
      // Initial bulk load: not wrapped in transition (renders skeleton → data ASAP)
      setAllRequests: (...a) => {
        callbacksRef.current.setAllRequests?.(...a);
        clearLoading();
      },
      // Secondary bulk updates: deferred — don't block user interactions
      setAllMessages: (...a) => startTransition(() => callbacksRef.current.setAllMessages?.(...a)),
      setAllUsers:    (...a) => startTransition(() => callbacksRef.current.setAllUsers?.(...a)),
      setBlacklist:   (e)    => startTransition(() => callbacksRef.current.setBlacklist?.(e)),
      onRequests: (docs) => {
        // Notifications are urgent — run immediately before transition
        const newP = docs.filter(r => r.type === 'pass' && r.status === 'pending').length;
        if (newP > prevPendingP.current && user.role === ROLES.SECURITY) {
          sendNotif('Новый пропуск', 'Требует рассмотрения', 'pass');
          playAlert('pass');
        }
        prevPendingP.current = newP;

        const newT = docs.filter(r => r.type === 'tech' && r.status === 'pending').length;
        if (newT > prevPendingT.current && canManageRequests(user.role)) {
          sendNotif('Техзаявка', 'Новая заявка в техслужбу', 'tech');
          playAlert('tech');
        }
        prevPendingT.current = newT;
        // State update is non-urgent: yield to typing, taps, navigation
        startTransition(() => {
          callbacksRef.current.setAllRequests?.(docs);
          clearLoading();
        });
      },
      onChat: (event) => {
        if (event.type === 'added' && event.message) {
          if (event.message.uid !== user.uid) {
            sendNotif(
              'Сообщение от ' + event.message.name,
              (event.message.text || '').slice(0, 60),
              'chat',
            );
          }
          // (счётчик непрочитанных ведётся через useNavBadges по chatLastSeen)
        }
      },
      onUsers:     (...a) => startTransition(() => callbacksRef.current.setAllUsers?.(...a)),
      onPerms:     (p)    => startTransition(() => callbacksRef.current.setPerms?.(user.uid, p)),
      onTemplates: (t)    => startTransition(() => callbacksRef.current.setTemplates?.(user.uid, t)),
      // Incremental SSE: blacklist / user changes
      onBlacklistAdd:    (entry) => startTransition(() => callbacksRef.current.addToBlacklist?.(entry)),
      onBlacklistRemove: (id)    => startTransition(() => callbacksRef.current.removeFromBlacklist?.(id)),
      onUserUpdate:      (u)     => startTransition(() => callbacksRef.current.updateUser?.(u.uid, u)),
      onUserDelete:      (uid)   => startTransition(() => callbacksRef.current.deleteUser?.(uid)),
      onUserAdd:         (u)     => startTransition(() => callbacksRef.current.addUser?.(u)),
      // PERF: Incremental SSE: request changes — вместо full REQUESTS_SET_ALL на каждый event
      onRequestUpdate:   (req)   => startTransition(() => callbacksRef.current.updateRequest?.(req.id, req)),
      onRequestAdd:      (req)   => startTransition(() => callbacksRef.current.addRequest?.(req)),
      onRequestDelete:   (id)    => startTransition(() => callbacksRef.current.deleteRequest?.(id)),
    }))
    .then(fn => {
      if (cancelled) {
        if (typeof fn === 'function') fn();
        return;
      }
      if (typeof fn === 'function') cleanupFn = fn;
    })
    .catch((err) => {
      logger.error('[useLiveSync] startSync failed', { message: err?.message });
      clearLoading(); // ошибка — тоже снимаем skeleton
    });

    return () => {
      cancelled = true;
      cleanupFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, user.uid, retryKey]);

  // DO-02: watchdog — if SSE reports online but no events for 60s, force real reconnect.
  // Previously only dispatched a fake rz:sse-status event (UI-only), which changed
  // the indicator but did NOT actually reconnect the SSE stream.
  // Now dispatches rz:sse-force-reconnect which Dashboard listens to and increments retryKey.
  useEffect(() => {
    if (!isLiveMode()) return;
    const WATCHDOG_INTERVAL_MS = 30_000;
    const STALE_THRESHOLD_MS   = 60_000;
    let lastActivity = Date.now();
    const onActivity = () => { lastActivity = Date.now(); };
    window.addEventListener('rz:sse-activity', onActivity);
    const interval = setInterval(() => {
      if (Date.now() - lastActivity > STALE_THRESHOLD_MS) {
        logger.warn('[useLiveSync] SSE stream stale — forcing reconnect');
        // Trigger real reconnect (Dashboard listens and increments retryKey)
        window.dispatchEvent(new CustomEvent('rz:sse-force-reconnect'));
        // Reset timer to avoid rapid-fire reconnects
        lastActivity = Date.now();
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rz:sse-activity', onActivity);
    };
  }, []);

  return { isLoading, sseOnline, ssePermanentError };
}
