/**
 * services/providers/apiClient.js
 * HTTP клиент для общения фронта с нашим backend API
 *
 * FIX [КРИТ-1]: JWT в HttpOnly cookie, не в localStorage.
 * FIX [AUDIT-1]: Request timeout — fetch без таймаута зависал навсегда при
 *   потере сети (браузер ждёт до 5 минут). AbortController прерывает по истечении.
 * FIX [AUDIT-2]: Retry logic — временные ошибки сети (503, 429, сбои сети)
 *   ретраются автоматически с экспоненциальным backoff.
 */

import { API_BASE_URL } from '../../config/apiBaseUrl.js';

const BASE_URL = API_BASE_URL;

/** Статусы, при которых ретрай бессмысленен */
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Базовый fetch с таймаутом.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs — максимальное время ожидания, по умолчанию 15с
 */
async function fetchWithTimeout(url, options, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Сервер не отвечает. Проверьте соединение.');
    }
    throw new Error('Нет соединения с сервером. Проверьте интернет.');
  } finally {
    clearTimeout(timer);
  }
}

// FIX [S1]: автоматический refresh token при 401
let _refreshPromise = null;
let _refreshFailed = false;

function makeRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function tryRefreshToken(requestId) {
  if (_refreshFailed) return false;
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = fetchWithTimeout(
    `${BASE_URL}/api/auth/refresh`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': getCsrfToken(), 'X-Request-Id': requestId },
    },
    10_000,
  ).then(res => {
    _refreshPromise = null;
    if (!res.ok) _refreshFailed = true;
    return res.ok;
  }).catch(() => {
    _refreshPromise = null;
    _refreshFailed = true;
    return false;
  });
  return _refreshPromise;
}

// Сброс при успешном login
export function resetRefreshState() { _refreshFailed = false; }

// FIX [AUDIT-6 #3]: CSRF double-submit — читаем cookie, отправляем в заголовке.
function getCsrfToken() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)rz-csrf=([^;]+)/);
    return match ? match[1] : '';
  } catch { return ''; }
}

/**
 * Выполняет HTTP запрос с ретраями при временных ошибках.
 */
async function api(method, path, body, { maxRetries = 2, headers: extraHeaders = {} } = {}) {
  let lastError;
  const requestId = makeRequestId();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
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
        // Мутирующие запросы имеют более щедрый таймаут
        method === 'GET' ? 10_000 : 20_000,
      );

      // FIX [S1]: 401 — пробуем refresh token перед сбросом сессии
      if (res.status === 401 && !path.includes('/auth/refresh')) {
        const refreshed = await tryRefreshToken(requestId);
        if (refreshed) {
          // Повторяем оригинальный запрос с новым access token
          continue;
        }
        window.dispatchEvent(new CustomEvent('rz:unauthorized'));
        throw new Error('Сессия истекла. Войдите снова.');
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error = new Error(err.error || `HTTP ${res.status}`);
        error.status = res.status;

        // Клиентские ошибки (4xx кроме 429) не ретраим
        if (NO_RETRY_STATUSES.has(res.status)) throw error;

        lastError = error;
        continue; // ретрай на 5xx, 429
      }

      // ВАЖ-2: сбрасываем _refreshFailed при любом успешном ответе.
      // Без этого: сервер временно недоступен → refresh возвращает 503 →
      // _refreshFailed=true → все следующие 401 разлогинивают пользователя
      // даже после восстановления сервера (требуется перезагрузка страницы).
      _refreshFailed = false;

      return res.json();

    } catch (err) {
      // Не ретраим: 401, клиентские ошибки, AbortError (уже обработан)
      if (err.status && NO_RETRY_STATUSES.has(err.status)) throw err;
      if (err.message.includes('Сессия истекла')) throw err;
      lastError = err;
    }
  }

  throw lastError;
}

/**
 * Загрузка фото (raw binary body).
 * Таймаут увеличен до 30с для медленных соединений.
 */
async function uploadPhoto(blob) {
  const res = await fetchWithTimeout(
    `${BASE_URL}/api/upload/photo`,
    {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-CSRF-Token': getCsrfToken() },
      credentials: 'include',
      body: blob,
    },
    30_000,
  );

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('rz:unauthorized'));
    throw new Error('Сессия истекла. Войдите снова.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const apiClient = {
  get:         (path)              => api('GET',    path),
  post:        (path, body, opts)  => api('POST',   path, body, opts),
  patch:       (path, body)        => api('PATCH',  path, body),
  delete:      (path, body)        => api('DELETE', path, body),
  uploadPhoto,
};

// FIX [AUDIT]: экспорт для сброса состояния в тестах.
// _refreshFailed и _refreshPromise — module-level singleton, что нормально для браузера,
// но без сброса тесты влияют друг на друга через shared state.
// Вызывайте _resetApiState() в beforeEach() ваших тестов.
export function _resetApiState() {
  _refreshPromise = null;
  _refreshFailed  = false;
}

export default apiClient;
