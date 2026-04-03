import { useState, useEffect, useRef, startTransition } from 'react';
import { canManageRequests } from '../domain/permissions.js';
import { ROLES } from '../domain/permissions.js';
import { sendNotif, playAlert } from '../utils.js';
import { isLiveMode, isDemoMode } from '../config/runtimeMode.js';
import { services } from '../services/providers/serviceContainer.js';

/**
 * useLiveSync — SSE-синхронизация с сервером.
 * A-15: SSE state updates wrapped in startTransition so that live data
 * updates yield to urgent user interactions (typing, taps, navigation).
 */
export function useLiveSync(user, {
  setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
  prevPendingP, prevPendingT,
  // P-02: retryKey increment triggers soft reconnect without page reload
  retryKey = 0,
}) {
  const [isLoading,   setIsLoading]   = useState(true);
  // FA-07: статус SSE-соединения для индикатора в header
  const [sseOnline, setSseOnline] = useState(true);

  useEffect(() => {
    const handler = (e) => setSseOnline(e.detail.connected);
    window.addEventListener('rz:sse-status', handler);
    return () => window.removeEventListener('rz:sse-status', handler);
  }, []);

  // Стабильный ref — колбэки обновляются без перезапуска эффекта
  const callbacksRef = useRef({});
  useEffect(() => {
    callbacksRef.current = { setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist };
  });

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
    }))
    .then(fn => {
      if (cancelled) {
        if (typeof fn === 'function') fn();
        return;
      }
      if (typeof fn === 'function') cleanupFn = fn;
    })
    .catch((err) => {
      console.error('[useLiveSync] startSync failed:', err);
      clearLoading(); // ошибка — тоже снимаем skeleton
    });

    return () => {
      cancelled = true;
      cleanupFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, user.uid, retryKey]);

  return { isLoading, sseOnline };
}
