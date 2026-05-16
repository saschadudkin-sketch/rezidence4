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
import { parseChatMessagesResponse, parseRequestsListResponse, parseUsersResponse, type EntityRow } from '../http/contractParsers';
import { emitSseActivity, emitSsePermanentError, emitSseRecoveredAfterGap, emitSseStatus } from '../../utils/events';
import { canTransitionOnFrontend } from '../contracts/statusTransitions';
import type {
  AuthService,
  ChatService,
  LiveDataCallbacks,
  RequestsService,
  ServiceContracts,
} from './ServiceContracts';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { ChatMessage } from '../../store/slices/chatSlice';
import type { AppUser } from '../../store/slices/usersSlice';
import type { BlacklistEntry } from '../../store/slices/blacklistSlice';
import type { PermEntry, Template, UserPerms } from '../../store/slices/permsSlice';
import type { VisitLogPage } from '../http/visitLogs';
import type { ChatDeletePayload, ChatMessageInput, ServiceAck } from './serviceDtos';

type AbortableRequestOptions = { signal?: AbortSignal };
type PagedRequestsOptions = AbortableRequestOptions & { onPage?: (requests: AppRequest[]) => void; background?: boolean };
type PagedChatOptions = AbortableRequestOptions & { onPage?: (messages: ChatMessage[]) => void; background?: boolean };
type UploadPhotoResult = { url?: string | null };
type UploadablePhoto = string;
type PermsPayloadInput = UserPerms | { visitors: readonly PermEntry[]; workers: readonly PermEntry[] } | Template[];

type BlacklistService = {
  getAll: () => Promise<BlacklistEntry[]>;
  add: (entry: Partial<BlacklistEntry>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

type UsersService = {
  getAll: (_opts?: AbortableRequestOptions) => Promise<AppUser[]>;
  update: (uid: string, patch: Partial<AppUser>) => Promise<unknown>;
  delete: (uid: string) => Promise<unknown>;
};

type VisitLogsService = {
  getAll: (opts?: { signal?: AbortSignal; page?: number; limit?: number; allPages?: boolean }) => Promise<VisitLogPage>;
  add: (entry: Record<string, unknown>) => Promise<unknown>;
  clear: () => Promise<unknown>;
};

type PermsService = {
  getPerms: (uid: string) => Promise<UserPerms>;
  savePerms: (uid: string, permsObj: PermsPayloadInput) => Promise<ServiceAck | unknown>;
  getTemplates: (uid: string) => Promise<Template[]>;
  saveTemplates: (uid: string, items: Template[]) => Promise<unknown>;
};

function normalizePermsPayload(perms: PermsPayloadInput): UserPerms | null {
  if (Array.isArray(perms)) return null;
  return {
    visitors: [...perms.visitors],
    workers: [...perms.workers],
  };
}

type DeletedRequestEvent = Pick<AppRequest, 'id'> & { status: 'deleted' };
type RequestUpdateEvent = AppRequest | DeletedRequestEvent;
type SseEventMap = {
  message: ChatMessage;
  message_update: ChatMessage;
  message_delete: ChatDeletePayload;
  request_update: RequestUpdateEvent;
  blacklist_add: BlacklistEntry;
  blacklist_remove: { id: string };
  user_update: AppUser;
  user_delete: { uid: string };
};

type SseEventName = keyof SseEventMap;

function isSseEventName(eventType: string): eventType is SseEventName {
  return eventType in {
    message: true,
    message_update: true,
    message_delete: true,
    request_update: true,
    blacklist_add: true,
    blacklist_remove: true,
    user_update: true,
    user_delete: true,
  };
}

function isDeletedRequestEvent(request: RequestUpdateEvent): request is DeletedRequestEvent {
  return request.status === 'deleted';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toDateValue(value: unknown): string | Date {
  return value instanceof Date || typeof value === 'string' ? value : new Date().toISOString();
}

function toRequestStatus(value: unknown): AppRequest['status'] {
  switch (value) {
    case 'approved':
    case 'accepted':
    case 'rejected':
    case 'arrived':
    case 'expired':
    case 'cancelled':
    case 'scheduled':
      return value;
    default:
      return 'pending';
  }
}

function toPermEntry(value: unknown): PermEntry | null {
  if (!isObject(value)) return null;
  return {
    id: toStringValue(value.id),
    name: toStringValue(value.name),
    phone: toStringValue(value.phone),
    carPlate: typeof value.carPlate === 'string' ? value.carPlate : undefined,
  };
}

function toUserPerms(value: unknown): UserPerms {
  if (!isObject(value)) return { visitors: [], workers: [] };
  const toEntries = (entries: unknown): PermEntry[] =>
    Array.isArray(entries) ? entries.map(toPermEntry).filter((entry): entry is PermEntry => entry !== null) : [];

  return {
    visitors: toEntries(value.visitors),
    workers: toEntries(value.workers),
  };
}

function toTemplate(value: unknown): Template | null {
  if (!isObject(value)) return null;
  return {
    id: toStringValue(value.id),
    name: toStringValue(value.name),
    type: toStringValue(value.type),
    category: toStringValue(value.category),
    visitorName: toStringValue(value.visitorName),
    visitorPhone: toStringValue(value.visitorPhone),
    carPlate: toStringValue(value.carPlate),
    comment: toStringValue(value.comment),
  };
}

function toBlacklistEntry(value: unknown): BlacklistEntry | null {
  if (!isObject(value)) return null;
  return {
    id: toStringValue(value.id),
    name: toStringValue(value.name),
    carPlate: toStringValue(value.carPlate),
    reason: toStringValue(value.reason),
    addedBy: toStringValue(value.addedBy),
    addedAt: new Date(value.addedAt instanceof Date || typeof value.addedAt === 'string' ? value.addedAt : Date.now()),
  };
}

function toAppRequest(row: EntityRow): AppRequest {
  const request: AppRequest = {
    id: toStringValue(row.id),
    type: row.type === 'tech' ? 'tech' : 'pass',
    status: toRequestStatus(row.status),
    createdAt: toDateValue(row.createdAt ?? row.created_at),
  };

  for (const [key, value] of Object.entries(row)) {
    request[key] = value;
  }

  return request;
}

function toAppUser(row: EntityRow): AppUser {
  return {
    uid: toStringValue(row.uid),
    name: toStringValue(row.name),
    phone: toStringValue(row.phone),
    role: typeof row.role === 'string' ? row.role as AppUser['role'] : 'owner',
    apartment: typeof row.apartment === 'string' ? row.apartment : undefined,
    parkingSpot: toNullableString(row.parkingSpot),
    avatar: toNullableString(row.avatar),
  };
}

function toAppRequests(rows: EntityRow[]): AppRequest[] {
  return rows.map(toAppRequest);
}

function toUsers(rows: EntityRow[]): AppUser[] {
  return rows.map(toAppUser);
}

function toPerms(payload: unknown): UserPerms {
  return toUserPerms(payload);
}

function toTemplates(payload: unknown): Template[] {
  return Array.isArray(payload) ? payload.map(toTemplate).filter((entry): entry is Template => entry !== null) : [];
}

function toBlacklist(payload: unknown): BlacklistEntry[] {
  return Array.isArray(payload) ? payload.map(toBlacklistEntry).filter((entry): entry is BlacklistEntry => entry !== null) : [];
}

function normalizeVisitLogPage(payload: unknown): VisitLogPage {
  if (!isObject(payload)) {
    return { data: [], total: 0, page: 1, limit: 100 };
  }

  const data = Array.isArray(payload.data)
    ? payload.data.filter((row): row is Record<string, unknown> => isObject(row))
    : [];

  return {
    data,
    total: typeof payload.total === 'number' ? payload.total : data.length,
    page: typeof payload.page === 'number' ? payload.page : 1,
    limit: typeof payload.limit === 'number' ? payload.limit : Math.max(data.length, 1),
  };
}

// ─── SSE — factory (fetch-based, JWT НЕ попадает в URL) ──────────────────────
function createSSEManager() {
  const realtimeState = createRealtimeStateMachine();
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isConnected     = false;  // explicit live-connection flag
  let currentUid: string | null = null;   // tracks active user UID to detect session change
  // Exponential backoff: reconnect delay doubles up to 30s to avoid hammering the server.
  let _reconnectDelay = 3_000;
  const _RECONNECT_MIN  = 3_000;
  const _RECONNECT_MAX  = 30_000;
  // Max retries before giving up and dispatching 'rz:sse-permanent-error'
  let _retryCount = 0;
  const MAX_SSE_RETRIES = 10;
  // Backend SSE is a live stream, not a durable event log. After a disconnect
  // the client reconnects the stream and separately triggers a full hydrate.
  let _lastEventId: string | null = null;
  let _needsFullResyncAfterReconnect = false;

  const sseHandlers: { [K in SseEventName]: Array<(payload: SseEventMap[K]) => void> } = {
    message: [], message_update: [], message_delete: [], request_update: [],
    // Real-time incremental updates for blacklist and user roster
    blacklist_add: [], blacklist_remove: [],
    user_update: [], user_delete: [],
  };

  function scheduleReconnect(reason: string) {
    abortController = null;
    isConnected = false;
    _needsFullResyncAfterReconnect = true;
    _retryCount += 1;
    emitSseStatus({ connected: false });
    realtimeState.transition(REALTIME_STATES.DEGRADED);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (_retryCount >= MAX_SSE_RETRIES) {
      logger.warn(`[SSE] gave up after ${MAX_SSE_RETRIES} retries`);
      emitSsePermanentError();
      realtimeState.transition(REALTIME_STATES.FAILED);
      return;
    }
    const jitter = 0.85 + Math.random() * 0.3; // 0.85..1.15 — anti-thundering-herd
    const delay = Math.round(_reconnectDelay * jitter);
    logger.warn(`[SSE] ${reason}, retry ${_retryCount}/${MAX_SSE_RETRIES} in ${Math.round(delay / 1000)}s`);
    _reconnectDelay = Math.min(_reconnectDelay * 1.5, _RECONNECT_MAX);
    reconnectTimer = setTimeout(() => connect(currentUid), delay);
  }

  async function connect(uid: string | null = null) {
    // Skip reconnect if already live on the same user session.
    // On user switch (logout + new login), force-disconnect first so the new
    // user doesn't inherit events from the previous session.
    if (isConnected) {
      if (uid && uid === currentUid) return;
      _forceDisconnect();
      _lastEventId = null;
    }

    currentUid  = uid;
    isConnected = true;
    realtimeState.transition(REALTIME_STATES.CONNECTING);

    abortController = new AbortController();
    const signal    = abortController.signal;
    const headers: Record<string, string> = {};

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
      if (_needsFullResyncAfterReconnect) {
        _needsFullResyncAfterReconnect = false;
        emitSseRecoveredAfterGap();
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const chunk of parts) {
          let eventType = 'message';
          let data      = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:'))  data      = line.slice(5).trim();
            if (line.startsWith('id:'))    _lastEventId = line.slice(3).trim();
          }
          if (data && isSseEventName(eventType)) {
            try {
              const parsed = JSON.parse(data) as SseEventMap[typeof eventType];
              const handlers = sseHandlers[eventType] as Array<(payload: typeof parsed) => void>;
              handlers.forEach((fn) => fn(parsed));
              // DO-02: notify heartbeat monitor of activity
              emitSseActivity();
            } catch { /* ignore malformed */ }
          }
        }
      }
      if (!signal.aborted) {
        scheduleReconnect('stream closed');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // намеренный disconnect
      scheduleReconnect('connection error');
    }
  }

  // Внутренний: разрывает соединение, не трогает handlers и currentUid
  function _forceDisconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
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
    _lastEventId = null;
    (Object.keys(sseHandlers) as SseEventName[]).forEach((key) => { sseHandlers[key] = []; });
  }

  function on<K extends SseEventName>(event: K, fn: (payload: SseEventMap[K]) => void) {
    sseHandlers[event].push(fn);
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
export const authProvider: AuthService = {
  async sendOtp(phone: string) {
    await apiClient.post('/api/v1/auth/send-otp', { phone }, { retryable: false });
  },
  async verifyOtp(phone: string, code: string) {
    // Сервер устанавливает HttpOnly cookie — токен не в теле ответа
    const { user } = await apiClient.post('/api/v1/auth/verify-otp', { phone, code }, { retryable: false });
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
    try {
      await apiClient.post('/api/v1/auth/logout', undefined, { retryable: false });
    } catch (err) {
      logger.error('[authProvider.logout] server logout failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      sseManager.disconnect();
    }
  },
};


// ─── Requests ─────────────────────────────────────────────────────────────────
export const requestsProvider: Pick<RequestsService, 'resolvePhotos'> & {
  getAll: (opts?: PagedRequestsOptions) => Promise<AppRequest[]>;
  create: (request: Partial<AppRequest>) => Promise<AppRequest>;
  update: (id: string, patch: Partial<AppRequest>, historyLabel?: string, expectedCurrentStatus?: AppRequest['status']) => Promise<ServiceAck | void>;
  delete: (id: string) => Promise<ServiceAck | void>;
} = {
  async getAll(opts?: PagedRequestsOptions) {
    // Incremental hydration:
    // 1) return page=1 immediately for fast first paint
    // 2) fetch remaining pages in background and push cumulative list via onPage callback
    // Supports either page-based or cursor-based pagination responses.
    const PAGE_SIZE = 200;
    const signal = opts?.signal;
    const onPage = typeof opts?.onPage === 'function' ? opts.onPage : null;
    const background = opts?.background !== false;

    const normalize = (payload: unknown) => parseRequestsListResponse(payload);

    const requestOpts = signal ? { signal } : undefined;
    const firstResp = requestOpts
      ? await apiClient.get(`/api/v1/requests?limit=${PAGE_SIZE}&page=1`, requestOpts)
      : await apiClient.get(`/api/v1/requests?limit=${PAGE_SIZE}&page=1`);
    const first = normalize(firstResp);
    const merged = toAppRequests([...first.rows]);
    if (!background) return merged;
    if (merged.length < PAGE_SIZE && first.total <= PAGE_SIZE && !first.nextCursor && !first.nextPage) return merged;

    (async () => {
      try {
        let page = 2;
        let cursor = first.nextCursor;
        const maxPages = first.total > 0 ? Math.ceil(first.total / PAGE_SIZE) : Number.POSITIVE_INFINITY;
        while (!signal?.aborted) {
          if (!cursor && page > maxPages) break;
          const query = cursor
            ? `/api/v1/requests?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
            : `/api/v1/requests?limit=${PAGE_SIZE}&page=${page}`;
          const nextResp = requestOpts ? await apiClient.get(query, requestOpts) : await apiClient.get(query);
          const nextPayload = normalize(nextResp);
          if (!nextPayload.rows.length) break;
          merged.push(...toAppRequests(nextPayload.rows));
          onPage?.([...merged]);
          cursor = nextPayload.nextCursor;
          if (!cursor) page = nextPayload.nextPage || (page + 1);
          // stop if server no longer returns pagination continuation
          if (!cursor && !nextPayload.nextPage && nextPayload.rows.length < PAGE_SIZE) break;
        }
      } catch (e) {
        if (signal?.aborted) return;
        logger.warn('[requestsProvider.getAll] background page fetch failed', getErrorMessage(e));
      }
    })();

    return [...merged];
  },
  async create(request: Partial<AppRequest>) {
    // Idempotency key prevents duplicate submissions on concurrent or retried requests.
    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const serverReq = await apiClient.post('/api/v1/requests', request, {
      retryable: false,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return serverReq;
  },
  async update(id: string, patch: Partial<AppRequest>, historyLabel?: string, expectedCurrentStatus?: AppRequest['status']) {
    if (patch.status && expectedCurrentStatus) {
      const me = await authProvider.getMe();
      const allowed = await canTransitionOnFrontend(me.role, expectedCurrentStatus, patch.status);
      if (!allowed) {
        const err = new Error(`Role '${me.role}' cannot transition status from '${expectedCurrentStatus}' to '${patch.status}'`) as Error & { status?: number };
        err.status = 403;
        throw err;
      }
    }
    return apiClient.patch(`/api/v1/requests/${id}`, { ...patch, historyLabel, expectedCurrentStatus });
  },
  async delete(id: string) {
    return apiClient.delete(`/api/v1/requests/${id}`);
  },
  async resolvePhotos(requestId: string, photos: UploadablePhoto[]) {
    // All photos upload in parallel via allSettled; 30s timeout per photo.
    const UPLOAD_TIMEOUT = 30_000;

    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timeout')), ms)
        ),
      ]) as Promise<T>;
    }

    const results = await Promise.allSettled(
      photos.map((photo) =>
        withTimeout(
          (async () => {
            // Convert base64 via atob() directly — avoids fetch(dataURL) which
            // fails under CSP and in test/SSR environments.
            let blob: Blob;
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
              try { parsed = new URL(photo, window.location.origin); } catch { throw new Error('Недопустимый URL фото'); }
              if (
                ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.origin !== window.location.origin)
                && !(parsed.protocol === 'blob:' && parsed.origin === window.location.origin)
              ) {
                throw new Error('Разрешены только local blob: и same-origin URL фото');
              }
              blob = await fetch(photo).then(r => r.blob());
            }
            const result = await apiClient.uploadPhoto(blob) as UploadPhotoResult;
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
export const chatProvider: ChatService & { getAllHistory: (opts?: PagedChatOptions) => Promise<ChatMessage[]> } = {
  // Returns { messages, hasMore }. before= loads history older than that message id.
  // search= performs full-history text search (КРИТ-2).
  async getMessages({ before, limit, search, signal }: { before?: string; limit?: number; search?: string; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (limit)  params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString();
    const reqOpts = signal ? { signal } : undefined;
    const data = reqOpts
      ? await apiClient.get(`/api/v1/chat/messages${qs ? '?' + qs : ''}`, reqOpts)
      : await apiClient.get(`/api/v1/chat/messages${qs ? '?' + qs : ''}`);
    const parsed = parseChatMessagesResponse(data);
    return parsed as { messages: ChatMessage[]; hasMore: boolean };
  },
  async getAllHistory(opts: { signal?: AbortSignal; onPage?: (messages: ChatMessage[]) => void; background?: boolean } = {}) {
    const PAGE_SIZE = 60;
    const signal = opts?.signal;
    const onPage = typeof opts?.onPage === 'function' ? opts.onPage : null;
    const background = opts?.background !== false;

    const first = await chatProvider.getMessages({ limit: PAGE_SIZE, signal });
    const merged = [...(first?.messages || [])];
    if (!background || !first?.hasMore || merged.length === 0) return merged;

    (async () => {
      try {
        let hasMore = Boolean(first?.hasMore);
        while (!signal?.aborted && hasMore) {
          const oldest = merged[0]?.id;
          if (typeof oldest !== 'string' || !oldest) break;
          const next = await chatProvider.getMessages({ before: oldest, limit: PAGE_SIZE, signal });
          const nextRows = [...(next?.messages || [])];
          if (!nextRows.length) break;
          merged.unshift(...nextRows);
          onPage?.([...merged]);
          hasMore = Boolean(next?.hasMore);
        }
      } catch (e) {
        if (signal?.aborted) return;
        logger.warn('[chatProvider.getAllHistory] background history fetch failed', getErrorMessage(e));
      }
    })();

    return merged;
  },
  async sendMessage(msg: ChatMessage | ChatMessageInput) {
    return apiClient.post('/api/v1/chat/messages', msg);
  },
  async updateMessage(id: string, patch: Partial<ChatMessage>) {
    return apiClient.patch(`/api/v1/chat/messages/${id}`, patch);
  },
  async deleteMessage(id: string) {
    return apiClient.delete(`/api/v1/chat/messages/${id}`);
  },
  async markSeen(uid: string) {
    return apiClient.post('/api/v1/chat/seen', { uid });
  },
  onMessage(fn)       { return sseManager.on('message', fn); },
  onMessageUpdate(fn) { return sseManager.on('message_update', fn); },
  onMessageDelete(fn) { return sseManager.on('message_delete', fn); },
};

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersProvider: UsersService = {
  async getAll(_opts?: { signal?: AbortSignal }) {
    const data = await apiClient.get('/api/v1/users');
    return toUsers(parseUsersResponse(data));
  },
  async update(uid: string, patch: Partial<AppUser>) {
    return apiClient.patch(`/api/v1/users/${uid}`, patch);
  },
  async delete(uid: string) {
    return apiClient.delete(`/api/v1/users/${uid}`);
  },
};

// ─── Blacklist ────────────────────────────────────────────────────────────────
export const blacklistProvider: BlacklistService = {
  async getAll() {
    return toBlacklist(await apiClient.get('/api/v1/blacklist'));
  },
  async add(entry: Partial<BlacklistEntry>) {
    return apiClient.post('/api/v1/blacklist', entry);
  },
  async remove(id: string) {
    return apiClient.delete(`/api/v1/blacklist/${id}`);
  },
};

// ─── Visit Logs ───────────────────────────────────────────────────────────────
export const visitLogsProvider: VisitLogsService = {
  async getAll({ signal, page = 1, limit = 100, allPages = true }: {
    signal?: AbortSignal;
    page?: number;
    limit?: number;
    allPages?: boolean;
  } = {}): Promise<VisitLogPage> {
    const requestOpts = signal ? { signal } : undefined;
    const buildPath = (pageNumber: number) => `/api/v1/visit-logs?page=${pageNumber}&limit=${limit}`;
    const firstResponse = requestOpts
      ? await apiClient.get(buildPath(page), requestOpts)
      : await apiClient.get(buildPath(page));
    const initial = normalizeVisitLogPage(firstResponse);

    if (!allPages || initial.total <= initial.data.length) {
      return initial;
    }

    const merged = [...initial.data];
    const totalPages = Math.max(1, Math.ceil(initial.total / initial.limit));

    for (let pageNumber = page + 1; pageNumber <= totalPages; pageNumber += 1) {
      const nextResponse = requestOpts
        ? await apiClient.get(buildPath(pageNumber), requestOpts)
        : await apiClient.get(buildPath(pageNumber));
      const nextPage = normalizeVisitLogPage(nextResponse);
      merged.push(...nextPage.data);
      if (nextPage.data.length < nextPage.limit) break;
    }

    return {
      ...initial,
      data: merged,
    };
  },
  async add(entry: Record<string, unknown>) {
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
export const permsProvider: PermsService = {
  async getPerms(uid: string) {
    return toPerms(await apiClient.get(`/api/v1/perms/${uid}`));
  },
  /**
   * Атомарно сохраняет perms через POST /api/v1/perms/batch (одна транзакция).
   * Legacy-формат (flat array) по-прежнему поддерживается через старый endpoint.
   */
  async savePerms(uid: string, permsObj: UserPerms | { visitors: readonly PermEntry[]; workers: readonly PermEntry[] } | Template[]) {
    // Legacy: flat array — assume visitors only (backward compat)
    if (Array.isArray(permsObj)) {
      return apiClient.post('/api/v1/perms', { uid, type: 'visitors', items: permsObj });
    }
    return apiClient.post('/api/v1/perms/batch', {
      uid,
      visitors: [...permsObj.visitors],
      workers: [...permsObj.workers],
    });
  },
  async getTemplates(uid: string) {
    return toTemplates(await apiClient.get(`/api/v1/templates/${uid}`));
  },
  async saveTemplates(uid: string, items: Template[]) {
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
      updateEverywhere: (args) => requestsProvider.update(args.requestId, args.patch, args.historyLabel, args.expectedCurrentStatus),
      deleteEverywhere: (args) => requestsProvider.delete(args.requestId),
      resolvePhotos:    requestsProvider.resolvePhotos.bind(requestsProvider),
    },
    admin: {
      savePermsEverywhere: async (args) => {
        const result = await permsProvider.savePerms(args.uid, args.perms) as ServiceAck | void;
        const normalizedPerms = normalizePermsPayload(args.perms);
        if (normalizedPerms) args.saveLocal?.(args.uid, normalizedPerms);
        return result;
      },
      saveUserEverywhere:   (args) => usersProvider.update(args.uid, args.patch) as Promise<ServiceAck | void>,
      removeUserEverywhere: (args) => usersProvider.delete(args.uid) as Promise<ServiceAck | void>,
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
      }: LiveDataCallbacks = {}) => {
        let mounted = true;

        // DA-01: bail out immediately if the caller already aborted (rapid retryKey change)
        if (signal?.aborted) return () => {};

        // Subscribe to request_update BEFORE the parallel fetch so events that arrive
        // during initial load are buffered and applied after — not silently dropped.
        const reqEventBuffer: RequestUpdateEvent[] = [];
        const bufferReqSub = sseManager.on('request_update', (req) => reqEventBuffer.push(req));

        // DA-01: pass signal to every provider call so the underlying apiClient fetch
        // is aborted immediately when the caller calls abortCtrl.abort().
        const fetchOpts = signal ? { signal } : {};

        // Параллельная загрузка ВСЕХ данных при старте
        let currentRequests: AppRequest[] = [];
        const requestsPromise = requestsProvider.getAll({
          ...fetchOpts,
          onPage: (nextRequests) => {
            if (!mounted) return;
            currentRequests = Array.isArray(nextRequests) ? [...nextRequests] : [];
            if (setAllRequests) setAllRequests(currentRequests);
            if (onRequests) onRequests(currentRequests);
          },
        });
        const chatPromise = chatProvider.getAllHistory({
          ...fetchOpts,
          onPage: (nextMessages) => {
            if (!mounted) return;
            if (setAllMessages) setAllMessages(nextMessages);
          },
        });
        const usersPromise = usersProvider.getAll(fetchOpts);
        const permsPromise = userUid ? permsProvider.getPerms(userUid) : Promise.resolve(null);
        const templatesPromise = userUid ? permsProvider.getTemplates(userUid) : Promise.resolve(null);
        const blacklistPromise = blacklistProvider.getAll().catch(() => []);

        const [
          reqsResult,
          chatResult,
          usersResult,
          permsResult,
          templatesResult,
          blacklistResult,
        ] = await Promise.allSettled([
          requestsPromise,
          chatPromise,
          usersPromise,
          permsPromise,
          templatesPromise,
          blacklistPromise,
        ]);

        const settledValues = [reqsResult, chatResult, usersResult, permsResult, templatesResult, blacklistResult].map((r, i) => {
          if (r.status === 'rejected') {
            logger.warn('[startSync] partial load failure at index ' + i, { message: getErrorMessage(r.reason) });
            return null;
          }
          return r.value;
        });
        const [reqs, chatData, users, permsData, templatesData, blacklistData] = settledValues as [
          AppRequest[] | null,
          ChatMessage[] | null,
          AppUser[] | null,
          UserPerms | null,
          Template[] | null,
          BlacklistEntry[] | null,
        ];

        // Отписаться от буфера — теперь будет live subscription ниже
        bufferReqSub();

        // DA-01: check abort signal after allSettled (signal aborted → stop immediately)
        if (signal?.aborted || !mounted) return () => {};

        // Применить буферизированные события к начальным данным перед отправкой в стор
        currentRequests = Array.isArray(reqs) ? [...reqs] : [];
        for (const bufferedReq of reqEventBuffer) {
          if (isDeletedRequestEvent(bufferedReq)) {
            currentRequests = currentRequests.filter((request) => request.id !== bufferedReq.id);
            continue;
          }
          const idx = currentRequests.findIndex(r => r.id === bufferedReq.id);
          if (idx >= 0) currentRequests[idx] = bufferedReq;
          else currentRequests = [bufferedReq, ...currentRequests];
        }

        if (setAllRequests) setAllRequests(currentRequests);
        if (onRequests) onRequests(currentRequests);
        if (setAllMessages && chatData) {
          setAllMessages([...chatData]);
        }
        if (setAllUsers && users)       setAllUsers([...users]);
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
        const unsubReq = sseManager.on('request_update', (req: RequestUpdateEvent) => {
          if (!mounted) return;
          // Удаление (soft-delete broadcast)
          if (isDeletedRequestEvent(req)) {
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
