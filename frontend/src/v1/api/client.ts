/**
 * platform-v1 fetch client.
 *
 * Invariants:
 *   - same-origin, cookies carry the JWT (credentials: 'include')
 *   - X-CSRF-Token header for all mutations, sourced from `rz-csrf` cookie
 *   - X-Request-Id header for every request (crypto.randomUUID)
 *   - GETs retry twice on network/5xx (exp backoff 100ms, 400ms)
 *   - timeout: 10s for GET, 20s for writes
 *   - errors classified into V1ErrorKind (see ./errors)
 *
 * D-lite §2: do NOT import from frontend/src/services/http/* — this client
 * is an independent v1 dependency.  Legacy behaviours (refresh-on-401,
 * event bus emits) intentionally omitted — v1 UI redirects to the login shell on
 * unauthorized.
 */

import { V1ApiError, classifyByStatus, type V1ApiErrorPayload } from './errors';
import { API_BASE_URL } from '../../config/apiBaseUrl';

const API_BASE = `${API_BASE_URL}/api/v1`;
const PROPERTY_SLUG = import.meta.env.VITE_PROPERTY_SLUG || (import.meta.env.DEV ? 'zamoskv' : '');
const GET_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 20_000;
const MAX_GET_RETRIES = 2;
const BACKOFF_MS = [100, 400];

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

export interface RequestOpts {
  signal?: AbortSignal;
  /** Skip CSRF header — only for debugging/tests. */
  skipCsrf?: boolean;
  /** Skip retry — useful for non-idempotent POSTs that we already retry manually. */
  skipRetry?: boolean;
  /** Override X-Request-Id. Default: crypto.randomUUID(). */
  requestId?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)rz-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function newRequestId(): string {
  // Prefer crypto.randomUUID; fall back to a cheap random id.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function composeSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onExternalAbort = () => controller.abort(external?.reason);

  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (external) external.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function parseBody(res: Response): Promise<V1ApiErrorPayload | string | null> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return (await res.json()) as V1ApiErrorPayload;
    } catch {
      return null;
    }
  }
  try {
    const text = await res.text();
    return text || null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractErrorMessage(parsed: V1ApiErrorPayload | string | null, status: number): string {
  if (typeof parsed === 'string' && parsed) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (
      parsed.error &&
      typeof parsed.error === 'object' &&
      typeof parsed.error.message === 'string' &&
      parsed.error.message
    ) {
      return parsed.error.message;
    }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  }
  return `HTTP ${status}`;
}

// ─── Core ───────────────────────────────────────────────────────────────────

async function performRequest<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  opts: RequestOpts,
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const isWrite = method !== 'GET';
  const timeoutMs = isWrite ? WRITE_TIMEOUT_MS : GET_TIMEOUT_MS;
  const requestId = opts.requestId ?? newRequestId();

  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('X-Request-Id', requestId);
  if (PROPERTY_SLUG) headers.set('X-Property-Slug', PROPERTY_SLUG);

  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  if (isWrite && !opts.skipCsrf) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  const { signal, cleanup } = composeSignal(opts.signal, timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: payload,
      signal,
    });
  } catch (err) {
    cleanup();
    const reason =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (signal.aborted && signal.reason === 'timeout')
        ? 'timeout'
        : 'network';
    throw new V1ApiError(reason, reason === 'timeout' ? 'Request timed out' : 'Network error', {
      status: null,
      requestId,
      cause: err,
    });
  } finally {
    cleanup();
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Unexpected — v1 endpoints always return JSON or 204.
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  const parsed = await parseBody(res);
  const kind = classifyByStatus(res.status);
  const message = extractErrorMessage(parsed, res.status);
  throw new V1ApiError(kind, message, {
    status: res.status,
    payload: parsed && typeof parsed === 'object' ? parsed : null,
    requestId,
  });
}

async function withRetry<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  opts: RequestOpts,
): Promise<T> {
  const retryable = method === 'GET' && !opts.skipRetry;
  if (!retryable) return performRequest<T>(method, path, body, opts);

  let attempt = 0;
  // Loop 1 + MAX_GET_RETRIES times total.
  while (true) {
    try {
      return await performRequest<T>(method, path, body, opts);
    } catch (err) {
      if (!(err instanceof V1ApiError)) throw err;
      const canRetry =
        attempt < MAX_GET_RETRIES &&
        (err.kind === 'network' ||
          err.kind === 'timeout' ||
          (err.kind === 'server' && err.status !== null && err.status >= 502));
      if (!canRetry) throw err;
      await delay(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      attempt += 1;
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

// Trailing comma inside `<T,>` disambiguates the generic from a JSX element.
// vite.config's esbuild loader is 'tsx' for all `.ts` files (see the block in
// vite.config.js), so a bare `<T>(` is parsed as a JSX opening tag.  The comma
// costs nothing at runtime and works in both .ts and .tsx.
export const v1Client = {
  get: <T,>(path: string, opts?: RequestOpts) => withRetry<T>('GET', path, undefined, opts ?? {}),
  post: <T,>(path: string, body?: unknown, opts?: RequestOpts) =>
    withRetry<T>('POST', path, body, opts ?? {}),
  patch: <T,>(path: string, body?: unknown, opts?: RequestOpts) =>
    withRetry<T>('PATCH', path, body, opts ?? {}),
  put: <T,>(path: string, body?: unknown, opts?: RequestOpts) =>
    withRetry<T>('PUT', path, body, opts ?? {}),
  delete: <T,>(path: string, opts?: RequestOpts) => withRetry<T>('DELETE', path, undefined, opts ?? {}),
};

// Exposed for unit tests only — they reset between suites.
export const __testing = { readCsrfCookie, newRequestId, composeSignal };
