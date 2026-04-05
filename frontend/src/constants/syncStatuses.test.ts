/**
 * constants/syncStatuses.test.js
 */
import { SYNC_STATUS } from './syncStatuses';

describe('SYNC_STATUS', () => {
  test('содержит LOCAL, REMOTE, LOCAL_FALLBACK', () => {
    expect(SYNC_STATUS.LOCAL).toBe('local');
    expect(SYNC_STATUS.REMOTE).toBe('remote');
    expect(SYNC_STATUS.LOCAL_FALLBACK).toBe('local_fallback');
  });

  test('все три значения уникальны', () => {
    const vals = Object.values(SYNC_STATUS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});
