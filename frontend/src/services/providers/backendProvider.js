/**
 * services/providers/backendProvider.js
 * Провайдер для нашего собственного Node.js + PostgreSQL backend.
 * Основной live-провайдер для деплоя на VPS.
 *
 * Активируется через: VITE_PROVIDER=backend в .env (если используется выбор провайдера)
 */

import apiClient from './apiClient.js';
import { resetRefreshState } from './apiClient.js';
import { logger } from '../logger.js';
import { API_BASE_URL } from '../../config/apiBaseUrl.js';

// ─── SSE — factory (fetch-based, JWT НЕ попадает в URL) ──────────────────────
function createSSEManager() {
  let abortController = null;
  let reconnectTimer  = null;
  let isConnected     = false;  // FIX [DATA-1]: явный флаг живого соединения
  let currentUid      = null;   // FIX [DATA-1]: для обнаружения смены пользователя
  // FIX [AUDIT-2]: exponential backoff — при нестабильном соединении клиент не
  // долбит сервер запросами каждые 3с, интервал растёт до 30с.
  let _reconnectDelay = 3_000;
  const _RECONNECT_MIN  = 3_000;
  const _RECONNECT_MAX  = 30_000;
  // FIX [AUDIT-2 #16]: сохраняем last event ID для replay при переподключении
  let _lastEventId = null;

  const sseHandlers = {
    message: [], message_update: [], message_delete: [], request_update: [],
  };

  async function connect(uid = null) {
    // FIX [DATA-1]: если соединение живое и пользователь тот же — ничего не делаем.
    // Если пользователь СМЕНИЛСЯ (logout одного + login другого) — принудительно
    // переподключаемся, иначе новый пользователь получал бы события под старой сессией.
    if (isConnected) {
      if (uid && uid === currentUid) return; // тот же юзер — уже подключены
      _forceDisconnect();                    // другой юзер — разрываем и переподключаем
    }

    currentUid  = uid;
    isConnected = true;

    abortController = new AbortController();
    const signal    = abortController.signal;
    // FIX [AUDIT-2 #16]: передаём Last-Event-ID при переподключении
    const headers = {};
    if (_lastEventId) headers['Last-Event-ID'] = _lastEventId;

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        credentials: 'include',
        signal,
        headers,
      });

      if (!response.ok || !response.body) throw new Error('SSE connection failed');

      // Успешное соединение — сбрасываем задержку до минимума
      _reconnectDelay = _RECONNECT_MIN;
      // FA-07: уведомляем React о восстановлении SSE-соединения
      window.dispatchEvent(new CustomEvent('rz:sse-status', { detail: { connected: true } }));

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
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // намеренный disconnect
      logger.warn(`[SSE] connection error, reconnecting in ${_reconnectDelay / 1000}s`, err.message);
      abortController = null;
      isConnected     = false;
      // FA-07: уведомляем React о разрыве SSE-соединения (будет переподключение)
      window.dispatchEvent(new CustomEvent('rz:sse-status', { detail: { connected: false } }));
      clearTimeout(reconnectTimer);
      const jitter = 0.85 + Math.random() * 0.3; // 0.85..1.15 — anti-thundering-herd
      const delay = Math.round(_reconnectDelay * jitter);
      // FIX [AUDIT-2]: exponential backoff — интервал удваивается, максимум 30с
      _reconnectDelay = Math.min(_reconnectDelay * 1.5, _RECONNECT_MAX);
      reconnectTimer  = setTimeout(() => connect(currentUid), delay);
    }
  }

  // Внутренний: разрывает соединение, не трогает handlers и currentUid
  function _forceDisconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    _reconnectDelay = _RECONNECT_MIN; // сбрасываем backoff при явном disconnect
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isConnected = false;
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
      // FIX [BUG]: disconnect() заменяет массивы на [] — старые unsubscribe замыкания
      // искали fn в старых массивах и ничего не находили (новый массив пустой).
      // Теперь ищем fn во ТЕКУЩЕМ массиве (sseHandlers[event]), а не в замыкании.
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
    await apiClient.post('/api/auth/send-otp', { phone });
  },
  async verifyOtp(phone, code) {
    // Сервер устанавливает HttpOnly cookie — токен не в теле ответа
    const { user } = await apiClient.post('/api/auth/verify-otp', { phone, code });
    // FIX [AUDIT-5 #6]: сбрасываем _refreshFailed при новом логине.
    // Без этого: временный 503 при refresh → _refreshFailed=true →
    // новый пользователь не может обновить access token даже после успешного входа.
    if (typeof resetRefreshState === 'function') resetRefreshState();
    // FIX [DATA-1]: передаём uid чтобы SSE мог корректно обработать смену пользователя
    sseManager.connect(user.uid);
    return user;
  },
  async getMe() {
    const { user } = await apiClient.get('/api/auth/me');
    // FIX [DATA-1]: передаём uid
    sseManager.connect(user.uid);
    return user;
  },
  async logout() {
    // Сервер сбрасывает HttpOnly cookie через Set-Cookie: token=; Max-Age=0
    await apiClient.post('/api/auth/logout').catch(() => {});
    sseManager.disconnect();
  },
};


// ─── Requests ─────────────────────────────────────────────────────────────────
export const requestsProvider = {
  async getAll() {
    // FIX [AUDIT-2 perf]: параллельная загрузка страниц вместо последовательной.
    // При 1000 заявках: 5 последовательных → 1 + 4 параллельных.
    const PAGE_SIZE = 200;
    const first = await apiClient.get(`/api/requests?limit=${PAGE_SIZE}&page=1`);
    const firstData = Array.isArray(first) ? first : (first.data || []);
    const total = first.total || firstData.length;

    if (firstData.length < PAGE_SIZE || total <= PAGE_SIZE) return firstData;

    const pages = Math.ceil(total / PAGE_SIZE);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        apiClient.get(`/api/requests?limit=${PAGE_SIZE}&page=${i + 2}`)
      )
    );
    return [firstData, ...rest.map(r => Array.isArray(r) ? r : (r.data || []))].flat();
  },
  async create(request) {
    // FIX [D1]: Idempotency Key — защита от дублирования при параллельных submit
    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const serverReq = await apiClient.post('/api/requests', request, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return serverReq;
  },
  async update(id, patch, historyLabel) {
    return apiClient.patch(`/api/requests/${id}`, { ...patch, historyLabel });
  },
  async delete(id) {
    return apiClient.delete(`/api/requests/${id}`);
  },
  async resolvePhotos(requestId, photos) {
    // FIX [DATA-2]: Promise.allSettled — все фото грузятся параллельно
    // FIX [DATA-2б]: добавлен timeout 30 сек на загрузку одного фото
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
            // FIX [BUG]: fetch(dataURL) — антипаттерн: создаёт синтетический HTTP запрос,
            // падает в CSP-ограниченных средах и при SSR/тестах.
            // Конвертируем base64 напрямую через atob() без сетевого слоя.
            let blob;
            if (photo.startsWith('data:')) {
              const [header, b64] = photo.split(',');
              const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
              const bytes = atob(b64);
              const buf   = new Uint8Array(bytes.length);
              for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
              blob = new Blob([buf], { type: mime });
            } else {
              // URL — загружаем как обычно (уже выгружено)
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
  // FIX [AUDIT-6]: API теперь возвращает { messages, hasMore } вместо плоского массива.
  // getMessages({ before }) — загрузить историю СТАРШЕ сообщения with id=before
  async getMessages({ before, limit } = {}) {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (limit)  params.set('limit', String(limit));
    const qs = params.toString();
    const data = await apiClient.get(`/api/chat/messages${qs ? '?' + qs : ''}`);
    // Поддержка старого формата (плоский массив) и нового ({ messages, hasMore })
    if (Array.isArray(data)) return { messages: data, hasMore: false };
    return data; // { messages: [...], hasMore: bool }
  },
  async sendMessage(msg) {
    return apiClient.post('/api/chat/messages', msg);
  },
  async updateMessage(id, patch) {
    return apiClient.patch(`/api/chat/messages/${id}`, patch);
  },
  async deleteMessage(id) {
    return apiClient.delete(`/api/chat/messages/${id}`);
  },
  async markSeen(uid) {
    return apiClient.post('/api/chat/seen', { uid });
  },
  onMessage(fn)       { return sseManager.on('message', fn); },
  onMessageUpdate(fn) { return sseManager.on('message_update', fn); },
  onMessageDelete(fn) { return sseManager.on('message_delete', fn); },
};

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersProvider = {
  async getAll() {
    return apiClient.get('/api/users');
  },
  async update(uid, patch) {
    return apiClient.patch(`/api/users/${uid}`, patch);
  },
  async delete(uid) {
    return apiClient.delete(`/api/users/${uid}`);
  },
};

// ─── Blacklist ────────────────────────────────────────────────────────────────
export const blacklistProvider = {
  async getAll() {
    return apiClient.get('/api/blacklist');
  },
  async add(entry) {
    return apiClient.post('/api/blacklist', entry);
  },
  async remove(id) {
    return apiClient.delete(`/api/blacklist/${id}`);
  },
};

// ─── Visit Logs ───────────────────────────────────────────────────────────────
export const visitLogsProvider = {
  async getAll() {
    return apiClient.get('/api/visit-logs');
  },
  async add(entry) {
    return apiClient.post('/api/visit-logs', entry);
  },
  /**
   * FIX [AUDIT-5 #2]: Backend DELETE /api/visit-logs requires
   * body { confirm: 'DELETE_ALL_LOGS' } as safety guard.
   * Without this the request always returns 400.
   */
  async clear() {
    return apiClient.delete('/api/visit-logs', { confirm: 'DELETE_ALL_LOGS' });
  },
};

// ─── Permissions & Templates ──────────────────────────────────────────────────
export const permsProvider = {
  async getPerms(uid) {
    return apiClient.get(`/api/perms/${uid}`);
  },
  /**
   * FIX [AUDIT-5 CRITICAL]: backend POST /api/perms requires `type` ('visitors'|'workers')
   * and `items` (array for that type). Frontend passes entire perms object {visitors:[], workers:[]}.
   * Without this fix ALL perms saves fail with 400 "Invalid type" in live mode.
   *
   * Solution: split into two sequential requests, one per type.
   * Using Promise.all for parallelism — the (uid, type) PK means no conflict.
   */
  async savePerms(uid, permsObj) {
    // Support both old format (flat array) and new format ({visitors:[], workers:[]})
    if (Array.isArray(permsObj)) {
      // Legacy: assume visitors
      return apiClient.post('/api/perms', { uid, type: 'visitors', items: permsObj });
    }
    const promises = [];
    if (permsObj.visitors !== undefined) {
      promises.push(apiClient.post('/api/perms', { uid, type: 'visitors', items: permsObj.visitors }));
    }
    if (permsObj.workers !== undefined) {
      promises.push(apiClient.post('/api/perms', { uid, type: 'workers', items: permsObj.workers }));
    }
    if (promises.length === 0) {
      return { ok: true };
    }
    const results = await Promise.all(promises);
    return results[results.length - 1]; // return last result for compat
  },
  async getTemplates(uid) {
    return apiClient.get(`/api/templates/${uid}`);
  },
  async saveTemplates(uid, items) {
    return apiClient.post('/api/templates', { uid, items });
  },
};

/**
 * Фабрика провайдера для createServices.js
 */
export function createBackendProvider() {
  return {
    provider: 'backend',
    auth: authProvider,
    chat: {
      sendMessage:   chatProvider.sendMessage.bind(chatProvider),
      updateMessage: chatProvider.updateMessage.bind(chatProvider),
      deleteMessage: chatProvider.deleteMessage.bind(chatProvider),
      onMessage:     chatProvider.onMessage.bind(chatProvider),
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
      startSync: async ({ onRequests, onChat, onUsers, setAllRequests, setAllMessages, setAllUsers,
        // FIX [AUDIT-6 CRITICAL]: добавлены колбэки для perms, templates, blacklist.
        // Ранее эти данные НЕ загружались при startSync — после F5 в live mode
        // перм-списки, шаблоны и чёрный список были пусты.
        onPerms, onTemplates, setBlacklist, userUid,
      }) => {
        let mounted = true;

        // Параллельная загрузка ВСЕХ данных при старте
        const promises = [
          requestsProvider.getAll(),
          chatProvider.getMessages(),
          usersProvider.getAll(),
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

        const [reqs, chatData, users, permsData, templatesData, blacklistData] = await Promise.all(promises);

        if (!mounted) return () => {};

        if (setAllRequests) setAllRequests(reqs);
        if (setAllMessages) setAllMessages(chatData.messages || chatData);
        if (setAllUsers)    setAllUsers(users);
        // FIX [AUDIT-6]: загруженные perms/templates/blacklist → в стор
        if (permsData && onPerms)       onPerms(permsData);
        if (templatesData && onTemplates) onTemplates(templatesData);
        if (setBlacklist && Array.isArray(blacklistData)) setBlacklist(blacklistData);

        let currentRequests = reqs;

        const unsubMsg    = chatProvider.onMessage(msg      => onChat && onChat({ type: 'added',   message: msg }));
        const unsubUpdate = chatProvider.onMessageUpdate(msg => onChat && onChat({ type: 'updated', message: msg }));
        const unsubDel    = chatProvider.onMessageDelete(d   => onChat && onChat({ type: 'deleted', id: d.id }));
        const unsubReq    = sseManager.on('request_update', req => {
          if (!mounted) return;
          const idx = currentRequests.findIndex(r => r.id === req.id);
          if (idx >= 0) {
            currentRequests = [...currentRequests];
            currentRequests[idx] = req;
          } else {
            currentRequests = [req, ...currentRequests];
          }
          if (setAllRequests) setAllRequests(currentRequests);
        });

        return () => {
          mounted = false;
          unsubMsg();
          unsubUpdate();
          unsubDel();
          unsubReq();
        };
      },
    },
  };
}
