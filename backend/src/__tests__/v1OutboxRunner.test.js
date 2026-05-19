'use strict';

/**
 * Phase 5 — v1 outboxRunner unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.5.
 *
 * Layers tested:
 *   • listActiveProperties — SELECT shape + order.
 *   • reapStuckRows — UPDATE shape, rowCount return, invalid-ttl guard.
 *   • tickAllProperties — per-tenant isolation (one bad tenant doesn't
 *     kill the tick), worker.runOnce params shape.
 *   • reapAllProperties — same isolation guarantees.
 *   • startOutboxRunner — feature-flag gate, no-db gate, multi-tenant
 *     mode, single-tenant mode, setInterval lifecycle, stop() clears both
 *     timers.
 */

const {
  describe, test, expect, beforeEach, afterEach, jest: jestApi,
} = require('@jest/globals');

// ─── Mock the worker so we can assert runner orchestration without hitting
//     pg advisory-lock paths or channel adapters. ───────────────────────────
jest.mock('../v1/workers/outboxWorker', () => ({
  runOnce: jest.fn(),
}));

const worker = require('../v1/workers/outboxWorker');
const runner = require('../v1/workers/outboxRunner');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeDb(rows = []) {
  // pg-pool-ish stub: both query() and connect() can be overridden per test.
  const db = {
    query: jestApi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
  return db;
}

function makeLogger() {
  return {
    info: jestApi.fn(),
    warn: jestApi.fn(),
    error: jestApi.fn(),
    debug: jestApi.fn(),
    child: jestApi.fn().mockReturnThis(),
  };
}

const ORIGINAL_ENV = process.env.NOTIFICATIONS_OUTBOX_ENABLED;

beforeEach(() => {
  jestApi.clearAllMocks();
  // Reset worker.runOnce to a benign default — individual tests override
  // via mockImplementation / mockResolvedValue.
  worker.runOnce.mockResolvedValue({ acquired: true, processed: 0 });
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
  } else {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = ORIGINAL_ENV;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// listActiveProperties
// ══════════════════════════════════════════════════════════════════════════════

describe('listActiveProperties', () => {
  test('rejects when platformDb missing .query', async () => {
    await expect(runner.listActiveProperties(null)).rejects.toThrow(/platformDb/);
    await expect(runner.listActiveProperties({})).rejects.toThrow(/platformDb/);
  });

  test('returns rows from SELECT on active properties', async () => {
    const db = makeDb([
      { id: 'p-a', slug: 'a', db_connection_url: 'postgres://a' },
      { id: 'p-b', slug: 'b', db_connection_url: 'postgres://b' },
    ]);
    const rows = await runner.listActiveProperties(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].slug).toBe('a');
  });

  test('query filters on is_active = true and orders by slug', async () => {
    const db = makeDb([]);
    await runner.listActiveProperties(db);
    const [[sql]] = db.query.mock.calls;
    expect(sql).toMatch(/FROM\s+properties/i);
    expect(sql).toMatch(/is_active\s*=\s*true/i);
    expect(sql).toMatch(/ORDER\s+BY\s+slug/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// reapStuckRows
// ══════════════════════════════════════════════════════════════════════════════

describe('reapStuckRows', () => {
  test('rejects invalid ttlMinutes', async () => {
    const db = makeDb();
    await expect(runner.reapStuckRows(db, { ttlMinutes: 0 })).rejects.toThrow(/ttlMinutes/);
    await expect(runner.reapStuckRows(db, { ttlMinutes: -5 })).rejects.toThrow(/ttlMinutes/);
    await expect(runner.reapStuckRows(db, { ttlMinutes: 1.5 })).rejects.toThrow(/ttlMinutes/);
  });

  test('issues UPDATE with status=pending filter + last_attempted_at window', async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [], rowCount: 3 });
    const n = await runner.reapStuckRows(db, { ttlMinutes: 30 });
    expect(n).toBe(3);

    const [[sql, params]] = db.query.mock.calls;
    expect(sql).toMatch(/UPDATE\s+notifications_outbox/i);
    expect(sql).toMatch(/SET\s+status\s*=\s*'pending'/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'in_flight'/i);
    expect(sql).toMatch(/last_attempted_at\s*<\s*NOW\(\)\s*-\s*\(\$1/i);
    expect(params).toEqual(['30']);
  });

  test('defaults ttlMinutes to 30 when not provided', async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await runner.reapStuckRows(db);
    const [[, params]] = db.query.mock.calls;
    expect(params).toEqual([String(runner.DEFAULT_STUCK_TTL_MINUTES)]);
  });

  test('returns 0 when rowCount undefined', async () => {
    const db = makeDb();
    db.query.mockResolvedValue({ rows: [] }); // no rowCount
    const n = await runner.reapStuckRows(db, { ttlMinutes: 10 });
    expect(n).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tickAllProperties
// ══════════════════════════════════════════════════════════════════════════════

describe('tickAllProperties', () => {
  test('rejects without getPool fn', async () => {
    const platformDb = makeDb([]);
    await expect(
      runner.tickAllProperties({ platformDb, getPool: null }),
    ).rejects.toThrow(/getPool/);
  });

  test('calls worker.runOnce once per active property with tenant context', async () => {
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a', db_connection_url: 'pg://a' },
      { id: 'p-b', slug: 'b', db_connection_url: 'pg://b' },
    ]);
    const poolA = { _pool: 'a' };
    const poolB = { _pool: 'b' };
    const getPool = jestApi.fn((prop) => (prop.slug === 'a' ? poolA : poolB));

    worker.runOnce
      .mockResolvedValueOnce({ acquired: true, processed: 3, sent: 2, failed: 1 })
      .mockResolvedValueOnce({ acquired: false, processed: 0 });

    const results = await runner.tickAllProperties({
      platformDb, getPool, batchSize: 25,
    });

    expect(worker.runOnce).toHaveBeenCalledTimes(2);
    expect(worker.runOnce).toHaveBeenNthCalledWith(1, poolA, {
      propertyId: 'p-a',
      batchSize: 25,
      tenant: { id: 'p-a', slug: 'a' },
    });
    expect(worker.runOnce).toHaveBeenNthCalledWith(2, poolB, {
      propertyId: 'p-b',
      batchSize: 25,
      tenant: { id: 'p-b', slug: 'b' },
    });

    expect(results).toEqual([
      { slug: 'a', acquired: true, processed: 3, sent: 2, failed: 1 },
      { slug: 'b', acquired: false, processed: 0 },
    ]);
  });

  test('isolates per-tenant throws — one bad tenant does not abort the tick', async () => {
    const logger = makeLogger();
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a', db_connection_url: 'pg://a' },
      { id: 'p-b', slug: 'b', db_connection_url: 'pg://b' },
      { id: 'p-c', slug: 'c', db_connection_url: 'pg://c' },
    ]);
    const getPool = jestApi.fn(() => ({ _pool: true }));

    worker.runOnce
      .mockResolvedValueOnce({ acquired: true, processed: 1 })
      .mockRejectedValueOnce(new Error('pool_exhausted'))
      .mockResolvedValueOnce({ acquired: true, processed: 2 });

    const results = await runner.tickAllProperties({
      platformDb, getPool, batchSize: 50, logger,
    });

    expect(worker.runOnce).toHaveBeenCalledTimes(3);
    expect(results[0]).toMatchObject({ slug: 'a', processed: 1 });
    expect(results[1]).toMatchObject({ slug: 'b', error: 'pool_exhausted' });
    expect(results[2]).toMatchObject({ slug: 'c', processed: 2 });
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      err: 'pool_exhausted',
      slug: 'b',
    });
  });

  test('falls back to slug when property.id missing', async () => {
    const platformDb = makeDb([
      { slug: 'legacy', db_connection_url: 'pg://legacy' },
    ]);
    const getPool = jestApi.fn(() => ({}));
    await runner.tickAllProperties({ platformDb, getPool });
    expect(worker.runOnce.mock.calls[0][1].propertyId).toBe('legacy');
  });

  test('no active properties → returns empty result array', async () => {
    const platformDb = makeDb([]);
    const getPool = jestApi.fn();
    const results = await runner.tickAllProperties({ platformDb, getPool });
    expect(results).toEqual([]);
    expect(worker.runOnce).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// reapAllProperties
// ══════════════════════════════════════════════════════════════════════════════

describe('reapAllProperties', () => {
  test('rejects without getPool fn', async () => {
    const platformDb = makeDb([]);
    await expect(
      runner.reapAllProperties({ platformDb, getPool: null }),
    ).rejects.toThrow(/getPool/);
  });

  test('runs reap per active property and aggregates counts', async () => {
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a' },
      { id: 'p-b', slug: 'b' },
    ]);
    const poolA = { query: jestApi.fn().mockResolvedValue({ rowCount: 2, rows: [] }) };
    const poolB = { query: jestApi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const getPool = jestApi.fn((prop) => (prop.slug === 'a' ? poolA : poolB));

    const logger = makeLogger();
    const results = await runner.reapAllProperties({
      platformDb, getPool, ttlMinutes: 45, logger,
    });

    expect(results).toEqual([
      { slug: 'a', reaped: 2 },
      { slug: 'b', reaped: 0 },
    ]);
    // Both received the same ttl
    expect(poolA.query.mock.calls[0][1]).toEqual(['45']);
    expect(poolB.query.mock.calls[0][1]).toEqual(['45']);
    // Only the non-zero reap log
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toMatchObject({ slug: 'a', reaped: 2 });
  });

  test('isolates per-tenant reap throws', async () => {
    const logger = makeLogger();
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a' },
      { id: 'p-b', slug: 'b' },
    ]);
    const poolA = { query: jestApi.fn().mockRejectedValue(new Error('boom')) };
    const poolB = { query: jestApi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    const getPool = jestApi.fn((prop) => (prop.slug === 'a' ? poolA : poolB));

    const results = await runner.reapAllProperties({
      platformDb, getPool, logger,
    });

    expect(results[0]).toMatchObject({ slug: 'a', error: 'boom' });
    expect(results[1]).toMatchObject({ slug: 'b', reaped: 1 });
    expect(logger.error).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startOutboxRunner — lifecycle gates
// ══════════════════════════════════════════════════════════════════════════════

describe('startOutboxRunner — gates', () => {
  test('does not start when feature flag is off', () => {
    delete process.env.NOTIFICATIONS_OUTBOX_ENABLED;
    const logger = makeLogger();
    const result = runner.startOutboxRunner({ logger });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('flag_disabled');
    // stop() must exist and be a no-op
    expect(typeof result.stop).toBe('function');
    expect(() => result.stop()).not.toThrow();
    expect(logger.info).toHaveBeenCalled();
  });

  test('flag set to "false" also refuses', () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'false';
    const result = runner.startOutboxRunner({ logger: makeLogger() });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('flag_disabled');
  });

  test('flag ON but no DB sources → refuses', () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const logger = makeLogger();
    const result = runner.startOutboxRunner({ logger });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('no_db');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('flag ON + multi-tenant → starts multi-tenant mode', () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const platformDb = makeDb([]);
    const getPool = jestApi.fn();
    const result = runner.startOutboxRunner({
      platformDb, getPool, logger: makeLogger(),
      intervalMs: 60_000, reapIntervalMs: 600_000,
    });
    try {
      expect(result.started).toBe(true);
      expect(result.mode).toBe('multi-tenant');
    } finally {
      result.stop();
    }
  });

  test('flag ON + only fallbackDb → starts single-tenant mode', () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const result = runner.startOutboxRunner({
      fallbackDb: makeDb(), logger: makeLogger(),
    });
    try {
      expect(result.started).toBe(true);
      expect(result.mode).toBe('single-tenant');
    } finally {
      result.stop();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startOutboxRunner — tick loop (fake timers)
// ══════════════════════════════════════════════════════════════════════════════

describe('startOutboxRunner — tick loop', () => {
  beforeEach(() => { jestApi.useFakeTimers(); });
  afterEach(() => { jestApi.useRealTimers(); });

  test('multi-tenant: advances interval → tickAllProperties runs', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const platformDb = makeDb([
      { id: 'p-a', slug: 'a' },
    ]);
    const pool = { query: jestApi.fn() };
    const getPool = jestApi.fn(() => pool);

    const result = runner.startOutboxRunner({
      platformDb, getPool, logger: makeLogger(),
      intervalMs: 1000, reapIntervalMs: 60_000,
    });
    try {
      expect(worker.runOnce).not.toHaveBeenCalled();
      await jestApi.advanceTimersByTimeAsync(1000);
      expect(worker.runOnce).toHaveBeenCalledTimes(1);
    } finally {
      result.stop();
    }
  });

  test('single-tenant: tick calls worker.runOnce on fallbackDb with default id', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const fallbackDb = makeDb();
    const logger = makeLogger();

    const result = runner.startOutboxRunner({
      fallbackDb, logger,
      intervalMs: 500, reapIntervalMs: 60_000,
    });
    try {
      await jestApi.advanceTimersByTimeAsync(500);
      expect(worker.runOnce).toHaveBeenCalledWith(fallbackDb, {
        propertyId: runner.DEFAULT_PROPERTY_ID,
        rowPropertyId: null,
        batchSize: runner.DEFAULT_BATCH_SIZE,
      });
    } finally {
      result.stop();
    }
  });

  test('single-tenant: reaper fires and issues UPDATE on fallbackDb', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const fallbackDb = makeDb();
    fallbackDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = runner.startOutboxRunner({
      fallbackDb, logger: makeLogger(),
      intervalMs: 10_000, // avoid incidental tick firing
      reapIntervalMs: 400, stuckTtlMinutes: 15,
    });
    try {
      await jestApi.advanceTimersByTimeAsync(400);

      const reapCall = fallbackDb.query.mock.calls.find(
        ([sql]) => /UPDATE\s+notifications_outbox/i.test(sql),
      );
      expect(reapCall).toBeTruthy();
      expect(reapCall[1]).toEqual(['15']);
    } finally {
      result.stop();
    }
  });

  test('tick loop swallows tickAllProperties throw and keeps running', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const logger = makeLogger();

    // platformDb.query rejects once, then resolves — listActiveProperties
    // therefore rejects on tick #1 but succeeds on tick #2.  Loop must
    // survive tick #1 without stopping.
    const platformDb = {
      query: jestApi.fn()
        .mockRejectedValueOnce(new Error('platform_db_down'))
        .mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const getPool = jestApi.fn();

    const result = runner.startOutboxRunner({
      platformDb, getPool, logger,
      intervalMs: 100, reapIntervalMs: 60_000,
    });
    try {
      await jestApi.advanceTimersByTimeAsync(100);

      expect(logger.error).toHaveBeenCalled();

      // Next tick must still fire
      await jestApi.advanceTimersByTimeAsync(100);

      expect(platformDb.query).toHaveBeenCalledTimes(2);
    } finally {
      result.stop();
    }
  });

  test('stop() clears both timers — no further ticks', async () => {
    process.env.NOTIFICATIONS_OUTBOX_ENABLED = 'true';
    const platformDb = makeDb([]);
    const getPool = jestApi.fn();

    const result = runner.startOutboxRunner({
      platformDb, getPool, logger: makeLogger(),
      intervalMs: 100, reapIntervalMs: 100,
    });

    result.stop();

    const platformCallsBefore = platformDb.query.mock.calls.length;
    await jestApi.advanceTimersByTimeAsync(500);

    // No additional queries after stop
    expect(platformDb.query.mock.calls.length).toBe(platformCallsBefore);
  });
});
