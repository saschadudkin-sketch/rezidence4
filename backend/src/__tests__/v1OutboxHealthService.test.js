'use strict';

/**
 * Phase 5 — outboxHealth service helper unit tests.
 * Spec: notifications-outbox-spec.md §4.5.
 *
 * Scope:
 *   • normalizeRow: pg-string → number coercion, null-age preservation,
 *     Math.round of fractional ages.
 *   • fetchTenantOutboxHealth: SQL shape + passthrough of pool errors.
 *   • aggregateSnapshots: counts sum, stuck_in_flight sum, oldest age is
 *     MAX (not SUM), null-propagation when all queues empty, ignores
 *     tenants with error.
 */

const { describe, test, expect } = require('@jest/globals');
const {
  QUERY_SQL,
  normalizeRow,
  fetchTenantOutboxHealth,
  aggregateSnapshots,
} = require('../v1/services/outboxHealth');

// ══════════════════════════════════════════════════════════════════════════════
// QUERY_SQL shape
// ══════════════════════════════════════════════════════════════════════════════

describe('outboxHealth.QUERY_SQL', () => {
  test('hits notifications_outbox with per-status FILTER clauses', () => {
    expect(QUERY_SQL).toMatch(/FROM\s+notifications_outbox/i);
    expect(QUERY_SQL).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'pending'\s*\)/i);
    expect(QUERY_SQL).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'in_flight'\s*\)/i);
    expect(QUERY_SQL).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'failed'\s*\)/i);
    expect(QUERY_SQL).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'dead'\s*\)/i);
  });

  test('stuck-in-flight window is 30 minutes', () => {
    expect(QUERY_SQL).toMatch(/INTERVAL\s+'30\s+minutes'/i);
  });

  test('sent-last-24h window is 24 hours', () => {
    expect(QUERY_SQL).toMatch(/INTERVAL\s+'24\s+hours'/i);
  });

  test('oldest age uses EXTRACT(EPOCH ...) with MIN(next_attempt_at)', () => {
    expect(QUERY_SQL).toMatch(/EXTRACT\(\s*EPOCH\s+FROM/i);
    expect(QUERY_SQL).toMatch(/MIN\(\s*next_attempt_at\s*\)/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// normalizeRow
// ══════════════════════════════════════════════════════════════════════════════

describe('normalizeRow', () => {
  test('coerces pg-string counts into numbers', () => {
    const out = normalizeRow({
      pending: '42',
      in_flight: '3',
      failed: '7',
      dead: '1',
      sent_last_24h: '1000',
      stuck_in_flight: '2',
      oldest_pending_age_seconds: '123.4',
    });
    expect(out).toEqual({
      counts: {
        pending: 42, in_flight: 3, failed: 7, dead: 1, sent_last_24h: 1000,
      },
      stuck_in_flight: 2,
      oldest_pending_age_seconds: 123,
    });
  });

  test('rounds fractional seconds (.5 → up, .4 → down)', () => {
    expect(normalizeRow({ oldest_pending_age_seconds: '10.5' }).oldest_pending_age_seconds).toBe(11);
    expect(normalizeRow({ oldest_pending_age_seconds: '10.4' }).oldest_pending_age_seconds).toBe(10);
  });

  test('preserves null oldest_pending_age_seconds', () => {
    expect(normalizeRow({ oldest_pending_age_seconds: null }).oldest_pending_age_seconds).toBeNull();
  });

  test('defaults missing fields to zeros', () => {
    expect(normalizeRow({})).toEqual({
      counts: { pending: 0, in_flight: 0, failed: 0, dead: 0, sent_last_24h: 0 },
      stuck_in_flight: 0,
      oldest_pending_age_seconds: null,
    });
  });

  test('handles undefined row (no rows returned)', () => {
    expect(normalizeRow(undefined).counts.pending).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// fetchTenantOutboxHealth
// ══════════════════════════════════════════════════════════════════════════════

describe('fetchTenantOutboxHealth', () => {
  test('throws if pool lacks .query', async () => {
    await expect(fetchTenantOutboxHealth(null)).rejects.toThrow(/pool with \.query/);
    await expect(fetchTenantOutboxHealth({})).rejects.toThrow(/pool with \.query/);
  });

  test('runs the aggregate SELECT and normalizes the row', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          pending: '5',
          in_flight: '1',
          failed: '0',
          dead: '2',
          sent_last_24h: '99',
          stuck_in_flight: '0',
          oldest_pending_age_seconds: '60',
        }],
      }),
    };
    const out = await fetchTenantOutboxHealth(pool);
    expect(pool.query).toHaveBeenCalledTimes(1);
    // fetchTenantOutboxHealth must pass the exact shared SQL — это
    // гарантирует, что QUERY_SQL — единственный источник правды.
    expect(pool.query.mock.calls[0][0]).toBe(QUERY_SQL);
    expect(out).toEqual({
      counts: { pending: 5, in_flight: 1, failed: 0, dead: 2, sent_last_24h: 99 },
      stuck_in_flight: 0,
      oldest_pending_age_seconds: 60,
    });
  });

  test('surfaces pool errors unchanged (caller decides 503/item.error)', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
    await expect(fetchTenantOutboxHealth(pool)).rejects.toThrow(/relation does not exist/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// aggregateSnapshots
// ══════════════════════════════════════════════════════════════════════════════

describe('aggregateSnapshots', () => {
  test('sums counts + stuck_in_flight across tenants', () => {
    const rollup = aggregateSnapshots([
      {
        slug: 'a',
        counts: { pending: 1, in_flight: 2, failed: 3, dead: 0, sent_last_24h: 10 },
        stuck_in_flight: 1, oldest_pending_age_seconds: 100,
      },
      {
        slug: 'b',
        counts: { pending: 4, in_flight: 0, failed: 0, dead: 1, sent_last_24h: 20 },
        stuck_in_flight: 2, oldest_pending_age_seconds: 50,
      },
    ]);
    expect(rollup.counts).toEqual({
      pending: 5, in_flight: 2, failed: 3, dead: 1, sent_last_24h: 30,
    });
    expect(rollup.stuck_in_flight).toBe(3);
  });

  test('oldest_pending_age_seconds is MAX, not SUM', () => {
    const rollup = aggregateSnapshots([
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: 100 },
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: 300 },
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: 50 },
    ]);
    expect(rollup.oldest_pending_age_seconds).toBe(300);
  });

  test('ignores null oldest ages; returns null when all queues empty', () => {
    const rollup = aggregateSnapshots([
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: null },
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: null },
    ]);
    expect(rollup.oldest_pending_age_seconds).toBeNull();
  });

  test('partial nulls — takes max of non-null', () => {
    const rollup = aggregateSnapshots([
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: null },
      { counts: {}, stuck_in_flight: 0, oldest_pending_age_seconds: 77 },
    ]);
    expect(rollup.oldest_pending_age_seconds).toBe(77);
  });

  test('excludes tenants with error property from rollup', () => {
    const rollup = aggregateSnapshots([
      {
        slug: 'a',
        counts: { pending: 10, in_flight: 0, failed: 0, dead: 0, sent_last_24h: 0 },
        stuck_in_flight: 0, oldest_pending_age_seconds: 100,
      },
      { slug: 'b', error: 'pool dead' },
    ]);
    expect(rollup.counts.pending).toBe(10);
    expect(rollup.oldest_pending_age_seconds).toBe(100);
    expect(rollup.stuck_in_flight).toBe(0);
  });

  test('empty input → zeros and null', () => {
    expect(aggregateSnapshots([])).toEqual({
      counts: { pending: 0, in_flight: 0, failed: 0, dead: 0, sent_last_24h: 0 },
      stuck_in_flight: 0,
      oldest_pending_age_seconds: null,
    });
  });

  test('tolerates null / undefined entries', () => {
    expect(() => aggregateSnapshots([null, undefined])).not.toThrow();
    expect(aggregateSnapshots([null]).counts.pending).toBe(0);
  });
});
