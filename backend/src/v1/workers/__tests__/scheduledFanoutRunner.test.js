'use strict';

// Phase 5 — scheduledFanoutRunner unit tests.
// Spec: announcements-v2-spec.md §3 + §4.5.
//
// Scope:
//   • listActiveProperties — SQL shape + guard against missing pool
//   • tickAllProperties — iterates properties, isolates per-tenant errors
//   • startScheduledFanoutRunner — feature-flag gate, no-db gate,
//     single-tenant vs multi-tenant mode selection, logger side-effects
//
// Всё на моках: `fanoutFn` подменяет `announcementsService.runScheduledFanout`,
// setInterval мы НЕ запускаем — мы вызываем `tickAllProperties` напрямую,
// поэтому `.unref()` и таймер не в scope юнит-тестов.

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

jest.mock('../../../logger', () => require('../../../__mocks__/logger'));

const ORIGINAL_FLAG = process.env.NOTIFICATIONS_OUTBOX_ENABLED;

function enableOutbox() { process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true'; }
function disableOutbox() { delete process.env.NOTIFICATIONS_OUTBOX_ENABLED; }

beforeEach(() => { jest.resetModules(); });
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
  else process.env.NOTIFICATIONS_OUTBOX_ENABLED = ORIGINAL_FLAG;
});

function loadRunner() {
  // require после установки env — isOutboxEnabled() читает env в момент вызова,
  // но loadRunner держит единый entry, чтобы не забыть.
  return require('../scheduledFanoutRunner');
}

// ══════════════════════════════════════════════════════════════════════════════
// listActiveProperties
// ══════════════════════════════════════════════════════════════════════════════

describe('listActiveProperties', () => {
  test('throws when platformDb missing', async () => {
    const { listActiveProperties } = loadRunner();
    await expect(listActiveProperties(null)).rejects.toThrow(/platformDb/);
    await expect(listActiveProperties({})).rejects.toThrow(/platformDb/);
  });

  test('returns rows sorted by slug', async () => {
    const { listActiveProperties } = loadRunner();
    const rows = [{ id: 'a', slug: 'alpha' }, { id: 'b', slug: 'beta' }];
    const query = jest.fn().mockResolvedValue({ rows });
    const result = await listActiveProperties({ query });
    expect(result).toEqual(rows);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/FROM properties/);
    expect(sql).toMatch(/is_active = true/);
    expect(sql).toMatch(/ORDER BY slug/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tickAllProperties
// ══════════════════════════════════════════════════════════════════════════════

describe('tickAllProperties', () => {
  test('requires getPool function', async () => {
    const { tickAllProperties } = loadRunner();
    await expect(
      tickAllProperties({ platformDb: { query: jest.fn() }, getPool: null }),
    ).rejects.toThrow(/getPool/);
  });

  test('iterates all properties and calls fanoutFn with their pool', async () => {
    const { tickAllProperties } = loadRunner();
    const properties = [
      { id: 'p1', slug: 'alpha' },
      { id: 'p2', slug: 'beta' },
    ];
    const platformDb = { query: jest.fn().mockResolvedValue({ rows: properties }) };
    const poolA = { _tag: 'pool-a' };
    const poolB = { _tag: 'pool-b' };
    const getPool = jest.fn((p) => (p.slug === 'alpha' ? poolA : poolB));
    const fanoutFn = jest.fn((pool) =>
      pool === poolA
        ? Promise.resolve([{ id: 'ann1', outbox_count: 3 }])
        : Promise.resolve([]),
    );

    const results = await tickAllProperties({ platformDb, getPool, fanoutFn, batchSize: 20 });

    expect(fanoutFn).toHaveBeenCalledTimes(2);
    expect(fanoutFn).toHaveBeenNthCalledWith(1, poolA, { batchSize: 20 });
    expect(fanoutFn).toHaveBeenNthCalledWith(2, poolB, { batchSize: 20 });
    expect(results).toEqual([
      { slug: 'alpha', fanout: [{ id: 'ann1', outbox_count: 3 }] },
      { slug: 'beta', fanout: [] },
    ]);
  });

  test('isolates per-tenant errors — one bad property does not stop the tick', async () => {
    const { tickAllProperties } = loadRunner();
    const properties = [
      { id: 'p1', slug: 'alpha' },
      { id: 'p2', slug: 'broken' },
      { id: 'p3', slug: 'gamma' },
    ];
    const platformDb = { query: jest.fn().mockResolvedValue({ rows: properties }) };
    const getPool = jest.fn((p) => ({ _tag: p.slug }));
    const fanoutFn = jest.fn((pool) => {
      if (pool._tag === 'broken') return Promise.reject(new Error('kaboom'));
      return Promise.resolve([]);
    });

    const results = await tickAllProperties({ platformDb, getPool, fanoutFn });
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ slug: 'alpha', fanout: [] });
    expect(results[1]).toMatchObject({ slug: 'broken', error: 'kaboom' });
    expect(results[2]).toEqual({ slug: 'gamma', fanout: [] });
    // gamma must have been reached AFTER the broken one threw.
    expect(fanoutFn).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startScheduledFanoutRunner — lifecycle gates
// ══════════════════════════════════════════════════════════════════════════════

describe('startScheduledFanoutRunner', () => {
  test('returns disabled when NOTIFICATIONS_OUTBOX_ENABLED is not set', () => {
    disableOutbox();
    const { startScheduledFanoutRunner } = loadRunner();
    const handle = startScheduledFanoutRunner({ fallbackDb: { query: jest.fn() } });
    expect(handle.started).toBe(false);
    expect(handle.mode).toBe('disabled');
    expect(handle.reason).toBe('flag_disabled');
    handle.stop(); // noop but must not throw
  });

  test('returns disabled when no db provided', () => {
    enableOutbox();
    const { startScheduledFanoutRunner } = loadRunner();
    const handle = startScheduledFanoutRunner({});
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe('no_db');
  });

  test('starts in single-tenant mode with fallbackDb only', () => {
    enableOutbox();
    const { startScheduledFanoutRunner } = loadRunner();
    const handle = startScheduledFanoutRunner({
      fallbackDb: { query: jest.fn() },
      intervalMs: 60_000,
      fanoutFn: jest.fn().mockResolvedValue([]),
    });
    try {
      expect(handle.started).toBe(true);
      expect(handle.mode).toBe('single-tenant');
    } finally {
      handle.stop();
    }
  });

  test('starts in multi-tenant mode with platformDb+getPool', () => {
    enableOutbox();
    const { startScheduledFanoutRunner } = loadRunner();
    const handle = startScheduledFanoutRunner({
      platformDb: { query: jest.fn().mockResolvedValue({ rows: [] }) },
      getPool: jest.fn(),
      intervalMs: 60_000,
      fanoutFn: jest.fn().mockResolvedValue([]),
    });
    try {
      expect(handle.started).toBe(true);
      expect(handle.mode).toBe('multi-tenant');
    } finally {
      handle.stop();
    }
  });
});
