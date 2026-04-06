import { describe, expect, test } from 'vitest';
import { buildDataPlaneContract, getDataPlane } from './dataPlanePolicy';

describe('dataPlanePolicy', () => {
  test('returns configured plane per entity', () => {
    expect(getDataPlane('requests')).toBe('sse-store');
    expect(getDataPlane('visitLogs')).toBe('query-cache');
  });

  test('builds unified loading/error contract', () => {
    expect(buildDataPlaneContract({
      syncLoading: true,
      timedOut: false,
      ssePermanentError: false,
      sseOnline: null,
    })).toEqual({
      loading: true,
      error: false,
      errorKind: null,
      sseOnline: null,
    });

    expect(buildDataPlaneContract({
      syncLoading: true,
      timedOut: true,
      ssePermanentError: false,
      sseOnline: false,
    }).errorKind).toBe('sse_timeout');
  });
});
