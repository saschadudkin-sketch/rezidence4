import { API_BASE_URL } from '../../config/apiBaseUrl.js';
import { fetchWithTimeout, parseApiResponse } from './transport.js';
import {
  NO_RETRY_STATUSES,
  getRetryDelayMs,
  getRetryDelayWithJitterMs,
  getRetryAfterDelayMs,
} from './retryPolicy.js';
import { getCsrfToken, makeRequestId } from './requestIdentity.js';
import { createAuthSession } from './authSession.js';
import { createUploadClient } from './uploadClient.js';

const BASE_URL = API_BASE_URL;

const authSession = createAuthSession({
  baseUrl: BASE_URL,
  fetchWithTimeout,
  getCsrfToken,
  makeRequestId,
});

async function api(method, path, body, { maxRetries = 2, headers: extraHeaders = {} } = {}) {
  let lastError;
  let nextRetryDelayMs = null;
  const retries = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 2;
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
        },
        method === 'GET' ? 10_000 : 20_000,
      );

      if (res.status === 401 && !path.includes('/auth/refresh')) {
        const refreshed = await authSession.tryRefreshToken(requestId);
        if (refreshed) continue;

        window.dispatchEvent(new CustomEvent('rz:unauthorized'));
        throw new Error('Сессия истекла. Войдите снова.');
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error = new Error(err.error || `HTTP ${res.status}`);
        error.status = res.status;

        if (NO_RETRY_STATUSES.has(res.status)) throw error;

        nextRetryDelayMs = getRetryAfterDelayMs(res.headers);
        lastError = error;
        continue;
      }

      authSession.markHealthy();
      return parseApiResponse(res);
    } catch (err) {
      if (err.status && NO_RETRY_STATUSES.has(err.status)) throw err;
      if (err.message.includes('Сессия истекла')) throw err;
      nextRetryDelayMs = null;
      lastError = err;
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
  get: (path, opts) => api('GET', path, undefined, opts),
  post: (path, body, opts) => api('POST', path, body, opts),
  patch: (path, body, opts) => api('PATCH', path, body, opts),
  delete: (path, body, opts) => api('DELETE', path, body, opts),
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
