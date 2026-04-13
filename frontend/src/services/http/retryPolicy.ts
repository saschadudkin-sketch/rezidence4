/** Статусы, при которых ретрай бессмысленен */
export const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

export function getRetryDelayMs(attempt: number) {
  return Math.min(1000 * (2 ** (attempt - 1)), 10_000);
}

/**
 * Full jitter: [0..baseDelay]. Снижает synchronized retry шторм.
 */
export function getRetryDelayWithJitterMs(attempt: number) {
  const base = getRetryDelayMs(attempt);
  return Math.floor(Math.random() * (base + 1));
}

export function getRetryAfterDelayMs(headers?: Headers | null) {
  const retryAfter = headers?.get?.('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}
