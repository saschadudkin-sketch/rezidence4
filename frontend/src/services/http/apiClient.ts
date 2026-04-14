import { API_BASE_URL } from '../../config/apiBaseUrl';
import { fetchWithTimeout, parseApiResponse } from './transport';
import {
  NO_RETRY_STATUSES,
  getRetryDelayMs,
  getRetryDelayWithJitterMs,
  getRetryAfterDelayMs,
} from './retryPolicy';
import { getCsrfToken, makeRequestId } from './requestIdentity';
import { createAuthSession } from './authSession';
import { createUploadClient } from './uploadClient';
// A-01: use centralized event registry instead of magic string
import { emitUnauthorized, emitSessionExpired } from '../../utils/events';
import { classifyHttpError } from './errorTaxonomy';

const BASE_URL = API_BASE_URL;

const authSession = createAuthSession({
  baseUrl: BASE_URL,
  fetchWithTimeout,
  getCsrfToken,
  makeRequestId,
});

interface ApiOptions {
  maxRetries?: number;
  retryable?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
}
interface ApiError extends Error { code?: string; kind?: string; status?: number; forbidden?: boolean; }

function shouldRetryRequest(method: string, retryable?: boolean) {
  if (typeof retryable === 'boolean') return retryable;
  return method === 'GET';
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  { maxRetries = 2, retryable, headers: extraHeaders = {}, signal }: ApiOptions = {},
) {
  let lastError;
  let nextRetryDelayMs = null;
  const retriesEnabled = shouldRetryRequest(method, retryable);
  const retries = retriesEnabled && Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0;
  const requestId = makeRequestId();

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delayMs = nextRetryDelayMs ?? getRetryDelayWithJitterMs(attempt);
      await new Promise(r => setTimeout(r, delayMs));
      nextRetryDelayMs = null;
    }

    try {
      const res = await fetchWithTimeout(
        `${BASE_URL}${path}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
            'X-Request-Id': requestId,
            ...extraHeaders,
          },
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
          signal: signal ?? undefined,
        },
        method === 'GET' ? 10_000 : 20_000,
      );

      if (res.status === 401 && !path.includes('/auth/refresh')) {
        const refreshed = await authSession.tryRefreshToken(requestId);
        if (refreshed) continue;

        // A-01: use typed emitter from centralized event registry
        const returnTo = typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/dashboard';
        emitSessionExpired({ reason: 'refresh_failed', returnTo });
        emitUnauthorized();
        // T-05: use error code instead of string matching for reliable catch
        const sessionErr: ApiError = new Error('Сессия истекла. Войдите снова.');
        sessionErr.code = 'SESSION_EXPIRED';
        sessionErr.kind = classifyHttpError(401, sessionErr.message);
        throw sessionErr;
      }

      // ВАЖНО-A5: centralized 403 handling — consistent forbidden error across all callers
      if (res.status === 403) {
        const err: ApiError = new Error('Недостаточно прав для выполнения этого действия');
        err.status = 403;
        err.forbidden = true;
        err.kind = classifyHttpError(403, err.message);
        throw err;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        const error: ApiError = new Error(errBody.error || `HTTP ${res.status}`);
        error.status = res.status;
        error.kind = classifyHttpError(res.status, error.message);

        if (!retriesEnabled || NO_RETRY_STATUSES.has(res.status)) throw error;

        nextRetryDelayMs = getRetryAfterDelayMs(res.headers);
        lastError = error;
        continue;
      }

      authSession.markHealthy();
      return parseApiResponse(res);
    } catch (err) {
      const e = err as ApiError;
      e.kind = e.kind || classifyHttpError(e.status, e.message);
      if (!retriesEnabled || (e.status && NO_RETRY_STATUSES.has(e.status))) throw e;
      if (e.code === 'ABORTED') throw e;
      // T-05: error code check — robust against message text changes/translations
      if (e.code === 'SESSION_EXPIRED') throw e;
      nextRetryDelayMs = null;
      lastError = e;
    }
  }

  throw lastError;
}

const uploadPhoto = createUploadClient({
  baseUrl: BASE_URL,
  fetchWithTimeout,
  getCsrfToken,
  makeRequestId,
});

export const apiClient = {
  get: (path: string, opts?: ApiOptions) => api('GET', path, undefined, opts),
  post: (path: string, body?: unknown, opts?: ApiOptions) => api('POST', path, body, opts),
  patch: (path: string, body?: unknown, opts?: ApiOptions) => api('PATCH', path, body, opts),
  delete: (path: string, body?: unknown, opts?: ApiOptions) => api('DELETE', path, body, opts),
  uploadPhoto,
};

export function resetRefreshState() {
  authSession.resetRefreshState();
}

export function _resetApiState() {
  authSession.resetState();
}

export { getRetryDelayMs as _getRetryDelayMs };
export { getRetryDelayWithJitterMs as _getRetryDelayWithJitterMs };

export default apiClient;
