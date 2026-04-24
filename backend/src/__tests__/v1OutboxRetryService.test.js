'use strict';

/**
 * Phase 5 — outboxRetry service helper unit tests.
 * Spec: notifications-outbox-spec.md §4.5 (operator escape-hatch).
 *
 * Scope:
 *   • validateParams: ids/status exclusivity, id shape, limit bounds.
 *   • resurrectOutboxRows: SQL shape (WHERE status IN dead,failed),
 *     ids vs bulk modes, RETURNING id passthrough.
 *   • Safety: never touches pending/in_flight/sent (enforced in SQL WHERE).
 */

const { describe, test, expect } = require('@jest/globals');
const {
  resurrectOutboxRows,
  validateParams,
  DEFAULT_LIMIT,
  HARD_LIMIT,
  ALLOWED_FROM,
} = require('../v1/services/outboxRetry');

// ══════════════════════════════════════════════════════════════════════════════
// validateParams
// ══════════════════════════════════════════════════════════════════════════════

describe('validateParams', () => {
  test('throws when neither ids nor status provided', () => {
    expect(() => validateParams({})).toThrow(/ids.*or.*status/i);
    expect(() => validateParams({ ids: [] })).toThrow(/ids.*or.*status/i);
  });

  test('throws when both ids and status provided', () => {
    expect(() => validateParams({ ids: ['a'], status: 'dead' })).toThrow(/mutually exclusive/i);
  });

  test('throws when any id is not a non-empty string', () => {
    expect(() => validateParams({ ids: [''] })).toThrow(/non-empty string/i);
    expect(() => validateParams({ ids: [null] })).toThrow(/non-empty string/i);
    expect(() => validateParams({ ids: [123] })).toThrow(/non-empty string/i);
  });

  test('throws when ids length exceeds HARD_LIMIT', () => {
    const ids = new Array(HARD_LIMIT + 1).fill('x');
    expect(() => validateParams({ ids })).toThrow(/hard cap/);
  });

  test('throws when status not in ALLOWED_FROM', () => {
    expect(() => validateParams({ status: 'sent' })).toThrow(/must be one of/i);
    expect(() => validateParams({ status: 'in_flight' })).toThrow(/must be one of/i);
    expect(() => validateParams({ status: 'pending' })).toThrow(/must be one of/i);
  });

  test('accepts status=dead and status=failed', () => {
    expect(() => validateParams({ status: 'dead' })).not.toThrow();
    expect(() => validateParams({ status: 'failed' })).not.toThrow();
  });

  test('throws on non-positive-integer limit', () => {
    expect(() => validateParams({ status: 'dead', limit: 0 })).toThrow(/positive integer/i);
    expect(() => validateParams({ status: 'dead', limit: -5 })).toThrow(/positive integer/i);
    expect(() => validateParams({ status: 'dead', limit: 3.14 })).toThrow(/positive integer/i);
  });

  test('throws when limit exceeds HARD_LIMIT', () => {
    expect(() => validateParams({ status: 'dead', limit: HARD_LIMIT + 1 })).toThrow(/hard cap/);
  });

  test('ALLOWED_FROM contains exactly dead + failed', () => {
    expect([...ALLOWED_FROM].sort()).toEqual(['dead', 'failed']);
  });

  test('DEFAULT_LIMIT sane + under HARD_LIMIT', () => {
    expect(DEFAULT_LIMIT).toBeGreaterThan(0);
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(HARD_LIMIT);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resurrectOutboxRows — ids mode
// ══════════════════════════════════════════════════════════════════════════════

describe('resurrectOutboxRows — ids mode', () => {
  test('issues UPDATE with WHERE id = ANY + status IN (dead,failed)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'row-1' }, { id: 'row-2' }],
    }) };
    const out = await resurrectOutboxRows(pool, { ids: ['row-1', 'row-2', 'row-3'] });
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+notifications_outbox/i);
    expect(sql).toMatch(/status\s*=\s*'pending'/i);
    expect(sql).toMatch(/attempt_count\s*=\s*0/);
    expect(sql).toMatch(/last_error\s*=\s*NULL/i);
    expect(sql).toMatch(/last_attempted_at\s*=\s*NULL/i);
    expect(sql).toMatch(/next_attempt_at\s*=\s*NOW\(\)/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*ANY\(\$1::uuid\[\]\)/i);
    expect(sql).toMatch(/AND\s+status\s+IN\s*\(\s*'dead'\s*,\s*'failed'\s*\)/i);
    expect(sql).toMatch(/RETURNING\s+id/i);

    // Args: [ids] only.
    expect(args).toEqual([['row-1', 'row-2', 'row-3']]);

    // Response: only the 2 that actually came back from RETURNING.
    expect(out).toEqual({ revived: 2, revivedIds: ['row-1', 'row-2'] });
  });

  test('returns 0 revived when no rows matched (e.g. all were already sent)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const out = await resurrectOutboxRows(pool, { ids: ['row-x'] });
    expect(out).toEqual({ revived: 0, revivedIds: [] });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resurrectOutboxRows — bulk (status) mode
// ══════════════════════════════════════════════════════════════════════════════

describe('resurrectOutboxRows — bulk mode', () => {
  test('issues subquery UPDATE with ORDER BY created_at + LIMIT', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    }) };
    const out = await resurrectOutboxRows(pool, { status: 'dead', limit: 50 });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE\s+id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+notifications_outbox/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*\$1/i);
    expect(sql).toMatch(/ORDER\s+BY\s+created_at/i);
    expect(sql).toMatch(/LIMIT\s+\$2/i);
    expect(args).toEqual(['dead', 50]);
    expect(out.revived).toBe(3);
  });

  test('uses DEFAULT_LIMIT when limit not provided', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await resurrectOutboxRows(pool, { status: 'failed' });
    expect(pool.query.mock.calls[0][1]).toEqual(['failed', DEFAULT_LIMIT]);
  });

  test('caps limit at HARD_LIMIT', async () => {
    // Validate step throws BEFORE going to DB — resurrect rejects limit>HARD_LIMIT.
    const pool = { query: jest.fn() };
    await expect(
      resurrectOutboxRows(pool, { status: 'dead', limit: HARD_LIMIT + 1 }),
    ).rejects.toThrow(/hard cap/);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// safety
// ══════════════════════════════════════════════════════════════════════════════

describe('resurrectOutboxRows — safety', () => {
  test('throws if pool has no .query (misuse)', async () => {
    await expect(resurrectOutboxRows(null, { status: 'dead' })).rejects.toThrow(/pool with \.query/);
    await expect(resurrectOutboxRows({}, { status: 'dead' })).rejects.toThrow(/pool with \.query/);
  });

  test('validation throws BEFORE any DB call', async () => {
    const pool = { query: jest.fn() };
    await expect(resurrectOutboxRows(pool, {})).rejects.toThrow(/ids.*or.*status/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("SQL never mentions 'sent' or 'in_flight' literals (cannot touch live rows)", async () => {
    // Sanity: we set status='pending' in SET (that's the whole point), but
    // the string 'sent' or 'in_flight' must NEVER appear — neither in SET
    // nor in WHERE.  If they did, force-retry could either reset a sent row
    // (idempotency broken) or race the worker mid-delivery (double-send).
    const poolIds  = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const poolBulk = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await resurrectOutboxRows(poolIds,  { ids: ['x'] });
    await resurrectOutboxRows(poolBulk, { status: 'dead' });
    for (const pool of [poolIds, poolBulk]) {
      const sql = pool.query.mock.calls[0][0];
      expect(sql).not.toMatch(/'sent'/);
      expect(sql).not.toMatch(/'in_flight'/);
    }
  });
});
