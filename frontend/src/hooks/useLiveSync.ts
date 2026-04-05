import { useState, useEffect, useRef, startTransition } from 'react';
import { isLiveMode, isDemoMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
import { logger } from '../services/logger';
import { useNewRequestNotifier } from './useNewRequestNotifier';
import { useStatusChangeNotifier } from './useStatusChangeNotifier';
// A-01: use centralized event registry instead of magic string literals
import { onSseStatus, onSsePermanentError, emitSseForceReconnect, onSseActivity, onRealtimeState } from '../utils/events.js';
// FIX [C-1]: sendNotif was called but not imported → ReferenceError on every incoming chat message
import { sendNotif } from '../utils.js';

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
    // A-01: use typed helpers from centralized event registry
    const cleanupStatus   = onSseStatus(({ connected }) => setSseOnline(connected));
    const cleanupPermanent = onSsePermanentError(() => setSsePermanentError(true));
    const cleanupRealtime = onRealtimeState(({ from, to, durationMs }) => {
      logger.info('[realtime-state]', { from, to, durationMs });
    });
    return () => { cleanupStatus(); cleanupPermanent(); cleanupRealtime(); };
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

  // ARCH-2: notification policy lives in its own hook, not here.
  const notifyNewRequests = useNewRequestNotifier(user);
  // N-02: toast when a resident's own request changes status (approved/rejected/etc.)
  const notifyStatusChange = useStatusChangeNotifier(user);

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

    // DA-01: AbortController cancels in-flight API calls (the parallel allSettled batch)
    // when retryKey changes before startSync resolves. Without this, a rapid
    // retryKey change causes two concurrent startSync calls to race — the slower
    // one could overwrite the store after the faster one has already populated it.
    const abortCtrl = new AbortController();

    let cleanupFn = null;
    let cancelled  = false;

    (async () => { try { const fn = await services.liveData.startSync({
      userUid:        user.uid,
      signal:         abortCtrl.signal,
      // Initial bulk load: not wrapped in transition (renders skeleton → data ASAP)
      // PERF3: each handler wrapped in try/catch — a bug in one handler must not
      // crash the entire SSE stream or prevent clearLoading() from being called.
      setAllRequests: (...a) => {
        try { callbacksRef.current.setAllRequests?.(...a); } catch (err) { logger.error('[useLiveSync] handler error in setAllRequests', { message: err?.message }); }
        clearLoading();
      },
      // Secondary bulk updates: deferred — don't block user interactions
      setAllMessages: (...a) => startTransition(() => { try { callbacksRef.current.setAllMessages?.(...a); } catch (err) { logger.error('[useLiveSync] handler error in setAllMessages', { message: err?.message }); } }),
      setAllUsers:    (...a) => startTransition(() => { try { callbacksRef.current.setAllUsers?.(...a); } catch (err) { logger.error('[useLiveSync] handler error in setAllUsers', { message: err?.message }); } }),
      setBlacklist:   (e)    => startTransition(() => { try { callbacksRef.current.setBlacklist?.(e); } catch (err) { logger.error('[useLiveSync] handler error in setBlacklist', { message: err?.message }); } }),
      onRequests: (docs) => {
        // Notifications are urgent — run immediately before transition
        try { notifyNewRequests(docs); } catch (err) { logger.error('[useLiveSync] handler error in notifyNewRequests', { message: err?.message }); }
        // State update is non-urgent: yield to typing, taps, navigation
        startTransition(() => {
          try {
            callbacksRef.current.setAllRequests?.(docs);
            clearLoading();
          } catch (err) {
            logger.error('[useLiveSync] handler error in onRequests/setAllRequests', { message: err?.message });
            clearLoading();
          }
        });
      },
      onChat: (event) => {
        try {
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
        } catch (err) { logger.error('[useLiveSync] handler error in onChat', { message: err?.message }); }
      },
      onUsers:     (...a) => startTransition(() => { try { callbacksRef.current.setAllUsers?.(...a); } catch (err) { logger.error('[useLiveSync] handler error in onUsers', { message: err?.message }); } }),
      onPerms:     (p)    => startTransition(() => { try { callbacksRef.current.setPerms?.(user.uid, p); } catch (err) { logger.error('[useLiveSync] handler error in onPerms', { message: err?.message }); } }),
      onTemplates: (t)    => startTransition(() => { try { callbacksRef.current.setTemplates?.(user.uid, t); } catch (err) { logger.error('[useLiveSync] handler error in onTemplates', { message: err?.message }); } }),
      // Incremental SSE: blacklist / user changes
      onBlacklistAdd:    (entry) => startTransition(() => { try { callbacksRef.current.addToBlacklist?.(entry); } catch (err) { logger.error('[useLiveSync] handler error in onBlacklistAdd', { message: err?.message }); } }),
      onBlacklistRemove: (id)    => startTransition(() => { try { callbacksRef.current.removeFromBlacklist?.(id); } catch (err) { logger.error('[useLiveSync] handler error in onBlacklistRemove', { message: err?.message }); } }),
      onUserUpdate:      (u)     => startTransition(() => { try { callbacksRef.current.updateUser?.(u.uid, u); } catch (err) { logger.error('[useLiveSync] handler error in onUserUpdate', { message: err?.message }); } }),
      onUserDelete:      (uid)   => startTransition(() => { try { callbacksRef.current.deleteUser?.(uid); } catch (err) { logger.error('[useLiveSync] handler error in onUserDelete', { message: err?.message }); } }),
      onUserAdd:         (u)     => startTransition(() => { try { callbacksRef.current.addUser?.(u); } catch (err) { logger.error('[useLiveSync] handler error in onUserAdd', { message: err?.message }); } }),
      // PERF: Incremental SSE: request changes — вместо full REQUESTS_SET_ALL на каждый event
      // N-02: notify resident before state update so toast appears before card re-renders
      onRequestUpdate:   (req)   => { try { notifyStatusChange(req); } catch (err) { logger.error('[useLiveSync] handler error in notifyStatusChange', { message: err?.message }); } startTransition(() => { try { callbacksRef.current.updateRequest?.(req.id, req); } catch (err) { logger.error('[useLiveSync] handler error in onRequestUpdate', { message: err?.message }); } }); },
      onRequestAdd:      (req)   => startTransition(() => { try { callbacksRef.current.addRequest?.(req); } catch (err) { logger.error('[useLiveSync] handler error in onRequestAdd', { message: err?.message }); } }),
      onRequestDelete:   (id)    => startTransition(() => { try { callbacksRef.current.deleteRequest?.(id); } catch (err) { logger.error('[useLiveSync] handler error in onRequestDelete', { message: err?.message }); } }),
    }); if (cancelled) { if (typeof fn === 'function') fn(); return; }
      if (typeof fn === 'function') cleanupFn = fn;
    } catch (err) {
      logger.error('[useLiveSync] startSync failed', { message: err?.message });
      clearLoading();
    } })();

    return () => {
      cancelled = true;
      // DA-01: abort any in-flight fetch calls immediately on cleanup
      abortCtrl.abort();
      cleanupFn?.();
    };
  // A-04: exhaustive-deps intentionally suppressed here.
  // This effect must only re-run when the user identity (uid/role) changes or when a
  // manual reconnect is requested (retryKey). The callbacks (setAllRequests, etc.) are
  // accessed via callbacksRef.current — a stable ref that is kept up-to-date on every
  // render — so they don't need to be in the dependency array and adding them would
  // cause the SSE stream to restart on every state update.
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
    // A-01: use typed helpers from centralized event registry
    const cleanupActivity = onSseActivity(() => { lastActivity = Date.now(); });
    const interval = setInterval(() => {
      if (Date.now() - lastActivity > STALE_THRESHOLD_MS) {
        logger.warn('[useLiveSync] SSE stream stale — forcing reconnect');
        // A-01: emit via typed helper instead of magic string literal
        emitSseForceReconnect();
        // Reset timer to avoid rapid-fire reconnects
        lastActivity = Date.now();
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      cleanupActivity();
    };
  }, []);

  return { isLoading, sseOnline, ssePermanentError };
}
