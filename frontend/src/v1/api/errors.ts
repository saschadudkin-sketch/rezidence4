/**
 * platform-v1 API error model.
 *
 * Thin, deterministic classification — UI binds to `kind`, never to HTTP
 * codes.  Keep the kind enum small; adding a new kind is a deliberate
 * product decision, not an incidental refactor.
 */

export type V1ErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized' // 401 — session expired / not logged in
  | 'forbidden' // 403 — auth ok, role not allowed
  | 'not_found' // 404
  | 'conflict' // 409 — optimistic concurrency / duplicate
  | 'validation' // 400 / 422
  | 'rate_limited' // 429
  | 'server' // 5xx
  | 'unknown';

export interface V1ApiErrorPayload {
  /** Server-provided error message, if JSON body carried one. */
  error?: string | { code?: string; message?: string };
  [key: string]: unknown;
}

export class V1ApiError extends Error {
  readonly kind: V1ErrorKind;
  readonly status: number | null;
  readonly payload: V1ApiErrorPayload | null;
  readonly requestId: string | null;

  constructor(
    kind: V1ErrorKind,
    message: string,
    opts: {
      status?: number | null;
      payload?: V1ApiErrorPayload | null;
      requestId?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'V1ApiError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.payload = opts.payload ?? null;
    this.requestId = opts.requestId ?? null;
    if (opts.cause !== undefined) {
      // Preserve original throwable for debugging; available on Error since ES2022.
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export function classifyByStatus(status: number): V1ErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'server';
  return 'unknown';
}

export function isV1ApiError(err: unknown): err is V1ApiError {
  return err instanceof V1ApiError;
}
