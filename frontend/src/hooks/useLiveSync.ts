import { useState, useEffect, useRef, startTransition } from 'react';
import { isLiveMode, isDemoMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
import { logger } from '../services/logger';
import { useNewRequestNotifier } from './useNewRequestNotifier';
import { useStatusChangeNotifier } from './useStatusChangeNotifier';
// A-01: use centralized event registry instead of magic string literals
import { onSseStatus, onSsePermanentError, onRealtimeState } from '../utils/events.js';
// FIX [C-1]: sendNotif was called but not imported → ReferenceError on every incoming chat message
import { sendNotif } from '../utils.js';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { ChatMessage } from '../store/slices/chatSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { BlacklistEntry } from '../store/slices/blacklistSlice';
import type { Template, UserPerms } from '../store/slices/permsSlice';
import type { LiveSyncChatEvent } from '../services/providers/serviceDtos';
import { useRealtimeWatchdog } from './useRealtimeWatchdog';

type LiveSyncCallbacks = {
  setAllRequests?: (requests: AppRequest[]) => void;
  setAllMessages?: (messages: ChatMessage[]) => void;
  setAllUsers?: (users: AppUser[]) => void;
  setPerms?: (uid: string, perms: UserPerms) => void;
  setTemplates?: (uid: string, templates: Template[]) => void;
  setBlacklist?: (entries: BlacklistEntry[]) => void;
  retryKey?: number;
  enabled?: boolean;
  addToBlacklist?: (entry: BlacklistEntry) => void;
  removeFromBlacklist?: (id: string) => void;
  updateUser?: (uid: string, patch: Partial<AppUser>, oldPhone?: string) => void;
  deleteUser?: (uid: string) => void;
  addUser?: (user: AppUser) => void;
  updateRequest?: (id: string, patch: Partial<AppRequest>) => void;
  addRequest?: (req: AppRequest) => void;
  deleteRequest?: (id: string) => void;
};

/**
 * useLiveSync — SSE-синхронизация с сервером.
 * A-15: SSE state updates wrapped in startTransition so that live data
 * updates yield to urgent user interactions (typing, taps, navigation).
 */
export function useLiveSync(user: Pick<AppUser, 'uid' | 'role'>, {
  setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
  // P-02: retryKey increment triggers soft reconnect without page reload
  retryKey = 0,
  enabled = true,
  // Incremental blacklist/user SSE updates
  addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
  // PERF: Incremental request SSE updates — избегаем full REQUESTS_SET_ALL при каждом событии
  updateRequest, addRequest, deleteRequest,
}: LiveSyncCallbacks) {
  const demoMode = isDemoMode();
  const liveSyncEnabled = enabled && !demoMode;
  const [isLoading,   setIsLoading]   = useState(liveSyncEnabled);
  // FA-07: статус SSE-соединения для индикатора в header
  const [sseOnline, setSseOnline] = useState(liveSyncEnabled ? true : null);
  // D-04: SSE достиг лимита попыток — требуется ручной retry
  const [ssePermanentError, setSsePermanentError] = useState(false);
  const [realtimeMode, setRealtimeMode] = useState<'healthy' | 'degraded' | 'open-circuit' | 'recovery'>('healthy');

  useEffect(() => {
    if (!liveSyncEnabled) return;
    // A-01: use typed helpers from centralized event registry
    const cleanupStatus   = onSseStatus(({ connected }) => setSseOnline(connected));
    const cleanupPermanent = onSsePermanentError(() => setSsePermanentError(true));
    const cleanupRealtime = onRealtimeState(({ from, to, durationMs }) => {
      logger.info('[realtime-state]', { from, to, durationMs });
    });
    return () => { cleanupStatus(); cleanupPermanent(); cleanupRealtime(); };
  }, [liveSyncEnabled]);

  // Стабильный ref — колбэки обновляются без перезапуска эффекта
  const callbacksRef = useRef<LiveSyncCallbacks>({});
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
  const notifyNewRequestsRef = useRef(notifyNewRequests);
  const notifyStatusChangeRef = useRef(notifyStatusChange);
  notifyNewRequestsRef.current = notifyNewRequests;
  notifyStatusChangeRef.current = notifyStatusChange;

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
    if (!liveSyncEnabled) {
      setIsLoading(false);
      setSseOnline(null);
      setSsePermanentError(false);
      return;
    }
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
      setAllRequests: (requests) => {
        try { callbacksRef.current.setAllRequests?.(requests); } catch (err) { logger.error('[useLiveSync] handler error in setAllRequests', { message: err?.message }); }
        clearLoading();
      },
      // Secondary bulk updates: deferred — don't block user interactions
      setAllMessages: (...a) => startTransition(() => { try { callbacksRef.current.setAllMessages?.(a[0]); } catch (err) { logger.error('[useLiveSync] handler error in setAllMessages', { message: err?.message }); } }),
      setAllUsers:    (...a) => startTransition(() => { try { callbacksRef.current.setAllUsers?.(a[0]); } catch (err) { logger.error('[useLiveSync] handler error in setAllUsers', { message: err?.message }); } }),
      setBlacklist:   (e)    => startTransition(() => { try { callbacksRef.current.setBlacklist?.(e); } catch (err) { logger.error('[useLiveSync] handler error in setBlacklist', { message: err?.message }); } }),
      onRequests: (docs) => {
        // Notifications are urgent — run immediately before transition
        try { notifyNewRequestsRef.current(docs); } catch (err) { logger.error('[useLiveSync] handler error in notifyNewRequests', { message: err?.message }); }
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
      onChat: (event: LiveSyncChatEvent) => {
        try {
          if (event.type === 'added' && event.message) {
            if (event.message.uid !== user.uid) {
              sendNotif(
                'Сообщение от ' + event.message.name,
                (typeof event.message.text === 'string' ? event.message.text : '').slice(0, 60),
                'chat',
              );
            }
            // (счётчик непрочитанных ведётся через useNavBadges по chatLastSeen)
          }
        } catch (err) { logger.error('[useLiveSync] handler error in onChat', { message: err?.message }); }
      },
      onUsers:     (...a) => startTransition(() => { try { callbacksRef.current.setAllUsers?.(a[0]); } catch (err) { logger.error('[useLiveSync] handler error in onUsers', { message: err?.message }); } }),
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
      onRequestUpdate:   (request) => { try { notifyStatusChangeRef.current(request); } catch (err) { logger.error('[useLiveSync] handler error in notifyStatusChange', { message: err?.message }); } startTransition(() => { try { callbacksRef.current.updateRequest?.(request.id, request); } catch (err) { logger.error('[useLiveSync] handler error in onRequestUpdate', { message: err?.message }); } }); },
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
  }, [
    liveSyncEnabled,
    user.role,
    user.uid,
    retryKey,
  ]);

  // DO-02: watchdog — if SSE reports online but no events for 60s, force a real reconnect.
  useRealtimeWatchdog(liveSyncEnabled, setRealtimeMode);

  return { isLoading, sseOnline, ssePermanentError, realtimeMode };
}
