import { describe, test, expect, vi, afterEach } from 'vitest';
import { getRetryAfterDelayMs } from './retryPolicy';

function makeHeaders(value) {
  return { get: vi.fn().mockImplementation(() => value) };
}

describe('getRetryAfterDelayMs', () => {
  afterEach(() => vi.restoreAllMocks());

  test('parses Retry-After as delta seconds', () => {
    expect(getRetryAfterDelayMs(makeHeaders('2'))).toBe(2000);
  });

  test('parses Retry-After as HTTP date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    const date = 'Wed, 01 Apr 2026 00:00:03 GMT';
    expect(getRetryAfterDelayMs(makeHeaders(date))).toBe(3000);
    vi.useRealTimers();
  });

  test('returns null for invalid header', () => {
    expect(getRetryAfterDelayMs(makeHeaders('n/a'))).toBeNull();
    expect(getRetryAfterDelayMs({ get: null })).toBeNull();
    expect(getRetryAfterDelayMs(null)).toBeNull();
  });
});
