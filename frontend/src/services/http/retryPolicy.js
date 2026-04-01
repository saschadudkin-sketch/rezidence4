/** Статусы, при которых ретрай бессмысленен */
export const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

export function getRetryDelayMs(attempt) {
  return Math.min(1000 * (2 ** (attempt - 1)), 10_000);
}

/**
 * Full jitter: [0..baseDelay]. Снижает synchronized retry шторм.
 */
export function getRetryDelayWithJitterMs(attempt) {
  const base = getRetryDelayMs(attempt);
  return Math.floor(Math.random() * (base + 1));
}
