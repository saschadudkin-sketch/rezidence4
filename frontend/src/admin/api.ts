/**
 * admin/api.ts — HTTP client for the DomHub superadmin SPA.
 *
 * Talks to /platform/api/v1/* endpoints.  Auth is a single bearer token that
 * the caller obtains from POST /auth/login and stores in localStorage under
 * STORAGE_KEY.  We deliberately do NOT share the tenant SPA's apiClient: the
 * tenant client sends cookies and fingerprinting headers that would break
 * platform-admin CSRF expectations, and keeping the two HTTP stacks separate
 * means a future auth rework in one cannot accidentally leak into the other.
 */
export const STORAGE_KEY = 'domhub.platform.token';

const API_BASE = '/platform/api/v1';

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Safari Private + full storage; the SPA will just ask to re-login. */
  }
}

async function request<T,>(
  method: string,
  path: string,
  body?: unknown,
  { skipAuth = false }: { skipAuth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!skipAuth) {
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // We don't rely on cookies for platform auth (JWT is in localStorage),
    // but `credentials: 'same-origin'` is still set so any reverse-proxy
    // injected session cookies aren't dropped on cross-path requests.
    credentials: 'same-origin',
  });

  // 204 No Content is legal; return undefined as T (caller should type-gate).
  if (res.status === 204) return undefined as unknown as T;

  let payload: unknown = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    payload = await res.json().catch(() => null);
  } else {
    payload = await res.text().catch(() => '');
  }

  if (!res.ok) {
    const err = payload as { error?: { code?: string; message?: string } } | null;
    const message = err?.error?.message || `HTTP ${res.status}`;
    const code = err?.error?.code;

    // Auto-logout on 401: the token expired or was revoked.  Wipe storage
    // before throwing so the auth context re-renders into the login page on
    // the next tick.
    if (res.status === 401 && !skipAuth) setToken(null);

    throw new ApiError(res.status, message, code, payload);
  }

  return payload as T;
}

export const api = {
  get:    <T,>(path: string)                    => request<T>('GET',    path),
  post:   <T,>(path: string, body?: unknown)    => request<T>('POST',   path, body),
  patch:  <T,>(path: string, body?: unknown)    => request<T>('PATCH',  path, body),
  delete: <T,>(path: string)                    => request<T>('DELETE', path),
  login:  <T,>(body: unknown)                   => request<T>('POST', '/auth/login', body, { skipAuth: true }),
};
