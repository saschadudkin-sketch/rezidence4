/**
 * services/providers/backendProvider.js
 * Провайдер для нашего собственного Node.js + PostgreSQL backend.
 * Основной live-провайдер для деплоя на VPS.
 *
 * Активируется через: VITE_PROVIDER=backend в .env (если используется выбор провайдера)
 */

import apiClient from './apiClient';
import { resetRefreshState } from './apiClient';
import { logger } from '../logger';
import { API_BASE_URL } from '../../config/apiBaseUrl';
import { createRealtimeStateMachine, REALTIME_STATES } from '../realtime/realtimeState';
import { emitSseActivity, emitSsePermanentError, emitSseStatus } from '../../utils/events';
import type { ServiceContracts } from './ServiceContracts';

// ─── SSE — factory (fetch-based, JWT НЕ попадает в URL) ──────────────────────
function createSSEManager() {
  const realtimeState = createRealtimeStateMachine();
  let abortController = null;
  let reconnectTimer  = null;
  let isConnected     = false;  // explicit live-connection flag
  let currentUid      = null;   // tracks active user UID to detect session change
  // Exponential backoff: reconnect delay doubles up to 30s to avoid hammering the server.
  let _reconnectDelay = 3_000;
  const _RECONNECT_MIN  = 3_000;
  const _RECONNECT_MAX  = 30_000;
  // Max retries before giving up and dispatching 'rz:sse-permanent-error'
  let _retryCount = 0;
  const MAX_SSE_RETRIES = 10;
  // Last-Event-ID: sent on reconnect so server can replay missed events.
  let _lastEventId = null;

  const sseHandlers = {
    message: [], message_update: [], message_delete: [], request_update: [],
    // Real-time incremental updates for blacklist and user roster
    blacklist_add: [], blacklist_remove: [],
    user_update: [], user_delete: [],
  };

  async function connect(uid = null) {
    // Skip reconnect if already live on the same user session.
    // On user switch (logout + new login), force-disconnect first so the new
    // user doesn't inherit events from the previous session.
    if (isConnected) {
      if (uid && uid === currentUid) return;
      _forceDisconnect();
    }

    currentUid  = uid;
    isConnected = true;
    realtimeState.transition(REALTIME_STATES.CONNECTING);

    abortController = new AbortController();
    const signal    = abortController.signal;
    // Pass Last-Event-ID so the server can replay missed events after reconnect.
    const headers = {};
    if (_lastEventId) headers['Last-Event-ID'] = _lastEventId;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/events`, {
        credentials: 'include',
        signal,
        headers,
      });

      if (!response.ok || !response.body) throw new Error('SSE connection failed');

      // Успешное соединение — сбрасываем задержку и счётчик попыток
      _reconnectDelay = _RECONNECT_MIN;
      _retryCount = 0;
      // FA-07: уведомляем React о восстановлении SSE-соединения
      emitSseStatus({ connected: true });
      realtimeState.transition(REALTIME_STATES.LIVE);

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const chunk of parts) {
          let eventType = 'message';
          let data      = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:'))  data      = line.slice(5).trim();
            if (line.startsWith('id:'))    _lastEventId = line.slice(3).trim();
          }
          if (data && sseHandlers[eventType]) {
            try {
              const parsed = JSON.parse(data);
              sseHandlers[eventType].forEach(fn => fn(parsed));
              // DO-02: notify heartbeat monitor of activity
              emitSseActivity();
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // намеренный disconnect
      abortController = null;
      isConnected     = false;
      _retryCount    += 1;
      // FA-07: уведомляем React о разрыве SSE-соединения
      emitSseStatus({ connected: false });
      realtimeState.transition(REALTIME_STATES.DEGRADED);
      clearTimeout(reconnectTimer);
      // D-04: после MAX_SSE_RETRIES — прекращаем автоматические попытки
      if (_retryCount >= MAX_SSE_RETRIES) {
        logger.warn(`[SSE] gave up after ${MAX_SSE_RETRIES} retries`);
        emitSsePermanentError();
        realtimeState.transition(REALTIME_STATES.FAILED);
        return;
      }
      const jitter = 0.85 + Math.random() * 0.3; // 0.85..1.15 — anti-thundering-herd
      const delay = Math.round(_reconnectDelay * jitter);
      logger.warn(`[SSE] connection error, retry ${_retryCount}/${MAX_SSE_RETRIES} in ${Math.round(delay / 1000)}s`);
      // Exponential backoff: multiply delay × 1.5, cap at RECONNECT_MAX.
      _reconnectDelay = Math.min(_reconnectDelay * 1.5, _RECONNECT_MAX);
      reconnectTimer  = setTimeout(() => connect(currentUid), delay);
    }
  }

  // Внутренний: разрывает соединение, не трогает handlers и currentUid
  function _forceDisconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    _reconnectDelay = _RECONNECT_MIN; // сбрасываем backoff при явном disconnect
    _retryCount = 0; // D-04: сбрасываем счётчик при явном переподключении
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isConnected = false;
    emitSseStatus({ connected: false });
    realtimeState.transition(REALTIME_STATES.IDLE);
  }

  // Публичный: полный сброс при logout — очищаем uid и все подписки
  function disconnect() {
    _forceDisconnect();
    currentUid = null;
    Object.keys(sseHandlers).forEach(k => { sseHandlers[k] = []; });
  }

  function on(event, fn) {
    sseHandlers[event]?.push(fn);
    return () => {
      // Read sseHandlers[event] fresh — not from closure — so unsubscribe
      // finds fn in the current array even after disconnect() replaced it.
      const arr = sseHandlers[event];
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  return { connect, disconnect, on };
}

// Singleton — один SSE менеджер на модуль
const sseManager = createSSEManager();

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authProvider = {
  async sendOtp(phone) {
    await apiClient.post('/api/v1/auth/send-otp', { phone });
  },
  async verifyOtp(phone, code) {
    // Сервер устанавливает HttpOnly cookie — токен не в теле ответа
    const { user } = await apiClient.post('/api/v1/auth/verify-otp', { phone, code });
    // Reset refresh-failed flag so the new session can obtain tokens normally.
    if (typeof resetRefreshState === 'function') resetRefreshState();
    // Pass uid so SSE manager can detect user switch and reconnect under new session.
    sseManager.connect(user.uid);
    return user;
  },
  async getMe() {
    const { user } = await apiClient.get('/api/v1/auth/me');
    sseManager.connect(user.uid);
    return user;
  },
  async logout() {
    // Сервер сбрасывает HttpOnly cookie через Set-Cookie: token=; Max-Age=0
    await apiClient.post('/api/v1/auth/logout').catch(() => {});
    sseManager.disconnect();
  },
};


// ─── Requests ─────────────────────────────────────────────────────────────────
export const requestsProvider = {
  async getAll(_opts?: { signal?: AbortSignal }) {
    // Pages fetched in parallel after the first: 1 sequential + N parallel.
    // При 1000 заявках: 5 последовательных → 1 + 4 параллельных.
    const PAGE_SIZE = 200;
    const first = await apiClient.get(`/api/v1/requests?limit=${PAGE_SIZE}&page=1`);
    const firstData = Array.isArray(first) ? first : (first.data || []);
    const total = first.total || firstData.length;

    if (firstData.length < PAGE_SIZE || total <= PAGE_SIZE) return firstData;

    const pages = Math.ceil(total / PAGE_SIZE);
    const pageNumbers = Array.from({ length: pages - 1 }, (_, i) => i + 2);
    const CONCURRENCY_LIMIT = 4;
    /** @type {Map<number, any>} */
    const pageResults = new Map();
    for (let i = 0; i < pageNumbers.length; i += CONCURRENCY_LIMIT) {
      const chunk = pageNumbers.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.all(
        chunk.map((page) =>
          apiClient.get(`/api/v1/requests?limit=${PAGE_SIZE}&page=${page}`)
            .then((result) => [page, result])
        )
      );
      chunkResults.forEach(([page, result]) => pageResults.set(page, result));
    }
    const orderedRest = pageNumbers.map((page) => pageResults.get(page));
    return [firstData, ...orderedRest.map(r => Array.isArray(r) ? r : (r.data || []))].flat();
  },
  async create(request) {
    // Idempotency key prevents duplicate submissions on concurrent or retried requests.
    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const serverReq = await apiClient.post('/api/v1/requests', request, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return serverReq;
  },
  async update(id, patch, historyLabel) {
    return apiClient.patch(`/api/v1/requests/${id}`, { ...patch, historyLabel });
  },
  async delete(id) {
    return apiClient.delete(`/api/v1/requests/${id}`);
  },
  async resolvePhotos(requestId, photos) {
    // All photos upload in parallel via allSettled; 30s timeout per photo.
    const UPLOAD_TIMEOUT = 30_000;

    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timeout')), ms)
        ),
      ]);
    }

    const results = await Promise.allSettled(
      photos.map((photo) =>
        withTimeout(
          (async () => {
            // Convert base64 via atob() directly — avoids fetch(dataURL) which
            // fails under CSP and in test/SSR environments.
            let blob;
            if (photo.startsWith('data:')) {
              const [header, b64] = photo.split(',');
              const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
              // SECURITY: validate MIME type before upload — prevents sending arbitrary binary data
              const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
              if (!ALLOWED_MIMES.has(mime.toLowerCase())) {
                throw new Error(`Неподдерживаемый формат файла: ${mime}. Разрешены: JPEG, PNG, WebP, GIF`);
              }
              const bytes = atob(b64);
              const buf   = new Uint8Array(bytes.length);
              for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
              blob = new Blob([buf], { type: mime });
            } else {
              // FIX [I-11]: validate URL before fetch — reject non-http(s) and non-same-origin external
              // to prevent SSRF-style leaks via crafted blob:/data:/javascript: URLs.
              let parsed;
              try { parsed = new URL(photo); } catch { throw new Error('Недопустимый URL фото'); }
              if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                throw new Error('Недопустимый протокол URL фото');
              }
              blob = await fetch(photo).then(r => r.blob());
            }
            const result = await apiClient.uploadPhoto(blob);
            if (!result.url) throw new Error('Server returned no URL');
            return result.url;
          })(),
          UPLOAD_TIMEOUT,
        )
      )
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn(`Не удалось загрузить ${failed} из ${photos.length} фото`);
    }

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  },
};

// ─── Chat ─────────────────────────────────────────────────────────────────────
export const chatProvider = {
  // Returns { messages, hasMore }. before= loads history older than that message id.
  // search= performs full-history text search (КРИТ-2).
  async getMessages({ before, limit, search }: { before?: string; limit?: number; search?: string; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (limit)  params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString();
    const data = await apiClient.get(`/api/v1/chat/messages${qs ? '?' + qs : ''}`);
    // Поддержка старого формата (плоский массив) и нового ({ messages, hasMore })
    if (Array.isArray(data)) return { messages: data, hasMore: false };
    return { messages: data?.messages || [], hasMore: Boolean(data?.hasMore) };
  },
  async sendMessage(msg) {
    return apiClient.post('/api/v1/chat/messages', msg);
  },
  async updateMessage(id, patch) {
    return apiClient.patch(`/api/v1/chat/messages/${id}`, patch);
  },
  async deleteMessage(id) {
    return apiClient.delete(`/api/v1/chat/messages/${id}`);
  },
  async markSeen(uid) {
    return apiClient.post('/api/v1/chat/seen', { uid });
  },
  onMessage(fn)       { return sseManager.on('message', fn); },
  onMessageUpdate(fn) { return sseManager.on('message_update', fn); },
  onMessageDelete(fn) { return sseManager.on('message_delete', fn); },
};

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersProvider = {
  async getAll(_opts?: { signal?: AbortSignal }) {
    return apiClient.get('/api/v1/users');
  },
  async update(uid, patch) {
    return apiClient.patch(`/api/v1/users/${uid}`, patch);
  },
  async delete(uid) {
    return apiClient.delete(`/api/v1/users/${uid}`);
  },
};

// ─── Blacklist ────────────────────────────────────────────────────────────────
export const blacklistProvider = {
  async getAll() {
    return apiClient.get('/api/v1/blacklist');
  },
  async add(entry) {
    return apiClient.post('/api/v1/blacklist', entry);
  },
  async remove(id) {
    return apiClient.delete(`/api/v1/blacklist/${id}`);
  },
};

// ─── Visit Logs ───────────────────────────────────────────────────────────────
export const visitLogsProvider = {
  async getAll() {
    return apiClient.get('/api/v1/visit-logs');
  },
  async add(entry) {
    return apiClient.post('/api/v1/visit-logs', entry);
  },
  /**
   * FIX [AUDIT-5 #2]: Backend DELETE /api/v1/visit-logs requires
   * body { confirm: 'DELETE_ALL_LOGS' } as safety guard.
   * Without this the request always returns 400.
   */
  async clear() {
    return apiClient.delete('/api/v1/visit-logs', { confirm: 'DELETE_ALL_LOGS' });
  },
};

// ─── Permissions & Templates ──────────────────────────────────────────────────
export const permsProvider = {
  async getPerms(uid) {
    return apiClient.get(`/api/v1/perms/${uid}`);
  },
  /**
   * Атомарно сохраняет perms через POST /api/v1/perms/batch (одна транзакция).
   * Legacy-формат (flat array) по-прежнему поддерживается через старый endpoint.
   */
  async savePerms(uid: string, permsObj: unknown[] | { visitors?: unknown; workers?: unknown }) {
    // Legacy: flat array — assume visitors only (backward compat)
    if (Array.isArray(permsObj)) {
      return apiClient.post('/api/v1/perms', { uid, type: 'visitors', items: permsObj });
    }
    // New format: use batch endpoint for atomic save
    const payload: Record<string, unknown> = { uid };
    if ((permsObj as Record<string, unknown>).visitors !== undefined) payload.visitors = (permsObj as Record<string, unknown>).visitors;
    if ((permsObj as Record<string, unknown>).workers  !== undefined) payload.workers  = (permsObj as Record<string, unknown>).workers;
    if (!payload.visitors && !payload.workers) return { ok: true };
    return apiClient.post('/api/v1/perms/batch', payload);
  },
  async getTemplates(uid) {
    return apiClient.get(`/api/v1/templates/${uid}`);
  },
  async saveTemplates(uid, items) {
    return apiClient.post('/api/v1/templates', { uid, items });
  },
};

/**
 * Фабрика провайдера для createServices.js
 */
export function createBackendProvider(): ServiceContracts {
  return {
    provider: 'backend',
    auth: authProvider,
    chat: {
      getMessages:   chatProvider.getMessages.bind(chatProvider),
      sendMessage:   chatProvider.sendMessage.bind(chatProvider),
      updateMessage: chatProvider.updateMessage.bind(chatProvider),
      deleteMessage: chatProvider.deleteMessage.bind(chatProvider),
      onMessage:     chatProvider.onMessage.bind(chatProvider),
      onMessageUpdate: chatProvider.onMessageUpdate.bind(chatProvider),
      onMessageDelete: chatProvider.onMessageDelete.bind(chatProvider),
      markSeen:      chatProvider.markSeen.bind(chatProvider),
    },
    requests: {
      submit:           (args) => requestsProvider.create(args.request),
      updateEverywhere: (args) => requestsProvider.update(args.requestId, args.patch, args.historyLabel),
      deleteEverywhere: (args) => requestsProvider.delete(args.requestId),
      resolvePhotos:    requestsProvider.resolvePhotos.bind(requestsProvider),
    },
    admin: {
      savePermsEverywhere:  (args) => permsProvider.savePerms(args.uid, args.perms),
      saveUserEverywhere:   (args) => usersProvider.update(args.uid, args.patch),
      removeUserEverywhere: (args) => usersProvider.delete(args.uid),
    },
    liveData: {
      startSync: async ({ onChat, setAllRequests, setAllMessages, setAllUsers,
        onPerms, onTemplates, setBlacklist, userUid,
        // DA-01: AbortSignal from useLiveSync — cancels the parallel initial fetch
        // when retryKey changes before startSync resolves (fast reconnect race).
        signal,
        // Incremental blacklist/user updates (SSE)
        onBlacklistAdd, onBlacklistRemove, onUserUpdate, onUserDelete,
        // PERF: Incremental request SSE updates — точечные действия вместо full replace
        // onRequestUpdate(req)  — обновить существующую заявку
        // onRequestAdd(req)     — добавить новую заявку
        // onRequestDelete(id)   — удалить заявку (soft-delete broadcast)
        onRequestUpdate, onRequestAdd, onRequestDelete, onRequests,
      }) => {
        let mounted = true;

        // DA-01: bail out immediately if the caller already aborted (rapid retryKey change)
        if (signal?.aborted) return () => {};

        // Subscribe to request_update BEFORE the parallel fetch so events that arrive
        // during initial load are buffered and applied after — not silently dropped.
        const reqEventBuffer = [];
        const bufferReqSub = sseManager.on('request_update', req => reqEventBuffer.push(req));

        // DA-01: pass signal to every provider call so the underlying apiClient fetch
        // is aborted immediately when the caller calls abortCtrl.abort().
        const fetchOpts = signal ? { signal } : {};

        // Параллельная загрузка ВСЕХ данных при старте
        const promises = [
          requestsProvider.getAll(fetchOpts),
          chatProvider.getMessages(fetchOpts),
          usersProvider.getAll(fetchOpts),
        ];
        // Perms и templates привязаны к uid — загружаем если uid передан
        if (userUid) {
          promises.push(permsProvider.getPerms(userUid));
          promises.push(permsProvider.getTemplates(userUid));
        } else {
          promises.push(Promise.resolve(null));
          promises.push(Promise.resolve(null));
        }
        // Blacklist — загружаем (может вернуть 403 для жильцов — ловим)
        promises.push(blacklistProvider.getAll().catch(() => []));

        // D-03: allSettled — если один эндпоинт упал, остальные данные всё равно загружаются
        const settled = await Promise.allSettled(promises);
        const settled_values = settled.map((r, i) => {
          if (r.status === 'rejected') {
            logger.warn('[startSync] partial load failure at index ' + i, { message: r.reason?.message });
            return null;
          }
          return r.value;
        });
        const [reqs, chatData, users, permsData, templatesData, blacklistData] = settled_values;

        // Отписаться от буфера — теперь будет live subscription ниже
        bufferReqSub();

        // DA-01: check abort signal after allSettled (signal aborted → stop immediately)
        if (signal?.aborted || !mounted) return () => {};

        // Применить буферизированные события к начальным данным перед отправкой в стор
        let currentRequests = reqs && Array.isArray(reqs) ? [...reqs] : (reqs?.data ? [...reqs.data] : []);
        for (const bufferedReq of reqEventBuffer) {
          const idx = currentRequests.findIndex(r => r.id === bufferedReq.id);
          if (idx >= 0) currentRequests[idx] = bufferedReq;
          else currentRequests = [bufferedReq, ...currentRequests];
        }

        if (setAllRequests) setAllRequests(currentRequests);
        if (onRequests) onRequests(currentRequests);
        if (setAllMessages && chatData) setAllMessages(chatData.messages || chatData);
        if (setAllUsers && users)       setAllUsers(users);
        // Push initial perms/templates/blacklist into AppStore after parallel fetch completes.
        if (permsData && onPerms)       onPerms(permsData);
        if (templatesData && onTemplates) onTemplates(templatesData);
        if (setBlacklist && Array.isArray(blacklistData)) setBlacklist(blacklistData);

        const unsubMsg    = chatProvider.onMessage(msg      => onChat && onChat({ type: 'added',   message: msg }));
        const unsubUpdate = chatProvider.onMessageUpdate(msg => onChat && onChat({ type: 'updated', message: msg }));
        const unsubDel    = chatProvider.onMessageDelete(d   => onChat && onChat({ type: 'deleted', id: d.id }));
        // PERF: Incremental SSE updates — вместо полной замены массива (REQUESTS_SET_ALL)
        // используем точечные операции REQUEST_UPDATE / REQUEST_ADD / REQUEST_DELETE.
        // При 500+ заявках staff-роли это убирает O(n) reconciler-прогон при каждом событии.
        // setAllRequests сохраняется только для начальной bulk-загрузки.
        const unsubReq = sseManager.on('request_update', req => {
          if (!mounted) return;
          // Удаление (soft-delete broadcast)
          if (req.status === 'deleted') {
            if (onRequestDelete) {
              onRequestDelete(req.id);
            } else {
              // Fallback: убрать из локального массива и обновить весь стор
              currentRequests = currentRequests.filter(r => r.id !== req.id);
              if (setAllRequests) setAllRequests(currentRequests);
            }
            return;
          }
          const idx = currentRequests.findIndex(r => r.id === req.id);
          if (idx >= 0) {
            // Существующая заявка — инкрементальное обновление
            currentRequests = [...currentRequests];
            currentRequests[idx] = req;
            if (onRequestUpdate) {
              onRequestUpdate(req);
            } else {
              if (setAllRequests) setAllRequests(currentRequests);
            }
          } else {
            // Новая заявка (ещё не в локальном массиве)
            currentRequests = [req, ...currentRequests];
            if (onRequestAdd) {
              onRequestAdd(req);
            } else {
              if (setAllRequests) setAllRequests(currentRequests);
            }
          }
        });

        // Real-time SSE subscriptions for blacklist and user roster updates.
        const unsubBLAdd    = sseManager.on('blacklist_add',    entry      => { if (!mounted) return; onBlacklistAdd?.(entry); });
        const unsubBLRemove = sseManager.on('blacklist_remove', ({ id })   => { if (!mounted) return; onBlacklistRemove?.(id); });
        const unsubUserUpd  = sseManager.on('user_update',      u          => { if (!mounted) return; onUserUpdate?.(u); });
        const unsubUserDel  = sseManager.on('user_delete',      ({ uid })  => { if (!mounted) return; onUserDelete?.(uid); });

        return () => {
          mounted = false;
          unsubMsg();
          unsubUpdate();
          unsubDel();
          unsubReq();
          unsubBLAdd();
          unsubBLRemove();
          unsubUserUpd();
          unsubUserDel();
        };
      },
    },
  };
}
