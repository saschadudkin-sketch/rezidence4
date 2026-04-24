'use strict';

// Phase 5 — packageSlaRunner unit tests.
// Spec: packages-v2-spec.md §5 (SLA reminders + auto-return).
//
// Scope:
//   • autoReturnOverdue — UPDATE shape, reason text, arg binding
//   • findRemindCandidates — SELECT shape (window, NOT EXISTS outbox)
//   • sendReminders — per-package isolation, conflict vs success counting
//   • tickSingleTenant — auto-return BEFORE reminder (order), summary
//   • tickAllProperties — per-tenant isolation (bad tenant ≠ killed tick)
//   • startPackageSlaRunner — feature-flag + no-db gates

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
  return require('../packageSlaRunner');
}

// ══════════════════════════════════════════════════════════════════════════════
// autoReturnOverdue
// ══════════════════════════════════════════════════════════════════════════════

describe('autoReturnOverdue', () => {
  test('throws for non-positive days', async () => {
    const { autoReturnOverdue } = loadRunner();
    await expect(autoReturnOverdue({ query: jest.fn() }, { days: 0 })).rejects.toThrow(/days/);
    await expect(autoReturnOverdue({ query: jest.fn() }, { days: -1 })).rejects.toThrow(/days/);
  });

  test('fires UPDATE with days + batchSize, returns RETURNING rows', async () => {
    const { autoReturnOverdue, AUTO_RETURN_REASON } = loadRunner();
    const returned = [{ id: 'p1', property_id: 'prop', unit_id: 'u1' }];
    const query = jest.fn().mockResolvedValue({ rows: returned });

    const result = await autoReturnOverdue({ query }, { days: 14, batchSize: 25 });

    expect(result).toEqual(returned);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE packages_v2/);
    expect(sql).toMatch(/status = 'returned'/);
    expect(sql).toMatch(/status = 'awaiting_pickup'/);
    expect(sql).toMatch(/RETURNING/);
    // [reason, days, batchSize]
    expect(args).toHaveLength(3);
    expect(args[0]).toContain(AUTO_RETURN_REASON);
    expect(args[0]).toContain('14');
    expect(args[1]).toBe('14');
    expect(args[2]).toBe(25);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// findRemindCandidates
// ══════════════════════════════════════════════════════════════════════════════

describe('findRemindCandidates', () => {
  test('throws if returnDays <= remindDays (guard against infinite reminder)', async () => {
    const { findRemindCandidates } = loadRunner();
    await expect(
      findRemindCandidates({ query: jest.fn() }, { remindDays: 7, returnDays: 7 }),
    ).rejects.toThrow(/returnDays must be/);
    await expect(
      findRemindCandidates({ query: jest.fn() }, { remindDays: 14, returnDays: 7 }),
    ).rejects.toThrow(/returnDays must be/);
  });

  test('selects awaiting_pickup in window, excludes already-reminded', async () => {
    const { findRemindCandidates } = loadRunner();
    const rows = [{ id: 'p1', property_id: 'prop' }];
    const query = jest.fn().mockResolvedValue({ rows });

    const result = await findRemindCandidates(
      { query },
      { remindDays: 7, returnDays: 14, batchSize: 50 },
    );

    expect(result).toEqual(rows);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/FROM packages_v2/);
    expect(sql).toMatch(/status = 'awaiting_pickup'/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/notifications_outbox/);
    expect(sql).toMatch(/event_type = 'package.pickup_reminder'/);
    expect(args).toEqual(['7', '14', 50]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sendReminders
// ══════════════════════════════════════════════════════════════════════════════

describe('sendReminders', () => {
  test('counts sent vs skipped based on remindFn result', async () => {
    const { sendReminders } = loadRunner();
    const remindFn = jest.fn()
      .mockResolvedValueOnce({ conflict: null, outboxRows: [{ id: 'o1' }, { id: 'o2' }] })
      .mockResolvedValueOnce({ conflict: 'picked_up', outboxRows: [] })
      .mockResolvedValueOnce({ conflict: null, outboxRows: [{ id: 'o3' }] });
    const candidates = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

    const stats = await sendReminders({}, candidates, { remindFn });
    expect(stats).toEqual({ sent: 2, skipped: 1, failed: 0 });
    expect(remindFn).toHaveBeenCalledTimes(3);
  });

  test('swallows per-package errors — one bad call does not abort batch', async () => {
    const { sendReminders } = loadRunner();
    const remindFn = jest.fn()
      .mockResolvedValueOnce({ conflict: null, outboxRows: [{ id: 'o1' }] })
      .mockRejectedValueOnce(new Error('db dead'))
      .mockResolvedValueOnce({ conflict: null, outboxRows: [{ id: 'o3' }] });
    const candidates = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

    const stats = await sendReminders({}, candidates, { remindFn });
    expect(stats).toEqual({ sent: 2, skipped: 0, failed: 1 });
    expect(remindFn).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tickSingleTenant — integration between sub-jobs
// ══════════════════════════════════════════════════════════════════════════════

describe('tickSingleTenant', () => {
  test('auto-return runs BEFORE reminder query (order matters)', async () => {
    const { tickSingleTenant } = loadRunner();

    const calls = [];
    const autoReturnFn = jest.fn(async () => {
      calls.push('autoReturn');
      return [{ id: 'x1' }, { id: 'x2' }];
    });
    const findRemindFn = jest.fn(async () => {
      calls.push('findRemind');
      return [{ id: 'r1' }];
    });
    const sendRemindersFn = jest.fn(async () => ({ sent: 1, skipped: 0, failed: 0 }));

    const stats = await tickSingleTenant({}, {
      autoReturnFn, findRemindFn, sendRemindersFn,
    });
    expect(calls).toEqual(['autoReturn', 'findRemind']);
    expect(stats).toEqual({
      autoReturned: 2,
      reminded: 1,
      skipped: 0,
      failed: 0,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tickAllProperties — per-tenant isolation
// ══════════════════════════════════════════════════════════════════════════════

describe('tickAllProperties', () => {
  test('isolates per-tenant errors', async () => {
    const { tickAllProperties } = loadRunner();
    const platformDb = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { id: 'p1', slug: 'alpha' },
          { id: 'p2', slug: 'broken' },
          { id: 'p3', slug: 'gamma' },
        ],
      }),
    };
    const getPool = jest.fn((p) => ({ _slug: p.slug }));
    const autoReturnFn = jest.fn(async (pool) => {
      if (pool._slug === 'broken') throw new Error('schema drift');
      return [];
    });
    const findRemindFn = jest.fn(async () => []);
    const sendRemindersFn = jest.fn(async () => ({ sent: 0, skipped: 0, failed: 0 }));

    const results = await tickAllProperties({
      platformDb, getPool,
      autoReturnFn, findRemindFn, sendRemindersFn,
    });

    expect(results).toHaveLength(3);
    expect(results[1]).toMatchObject({ slug: 'broken', error: 'schema drift' });
    expect(results[2]).toMatchObject({ slug: 'gamma', autoReturned: 0 });
    // gamma must have run after broken threw → autoReturnFn called thrice.
    expect(autoReturnFn).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startPackageSlaRunner — lifecycle gates
// ══════════════════════════════════════════════════════════════════════════════

describe('startPackageSlaRunner', () => {
  test('returns disabled when outbox flag is off', () => {
    disableOutbox();
    const { startPackageSlaRunner } = loadRunner();
    const handle = startPackageSlaRunner({ fallbackDb: { query: jest.fn() } });
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe('flag_disabled');
    handle.stop();
  });

  test('returns disabled when no db provided', () => {
    enableOutbox();
    const { startPackageSlaRunner } = loadRunner();
    const handle = startPackageSlaRunner({});
    expect(handle.started).toBe(false);
    expect(handle.reason).toBe('no_db');
  });

  test('starts in single-tenant mode with fallbackDb', () => {
    enableOutbox();
    const { startPackageSlaRunner } = loadRunner();
    const handle = startPackageSlaRunner({
      fallbackDb: { query: jest.fn() },
      autoReturnFn: jest.fn().mockResolvedValue([]),
      findRemindFn: jest.fn().mockResolvedValue([]),
      sendRemindersFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
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
    const { startPackageSlaRunner } = loadRunner();
    const handle = startPackageSlaRunner({
      platformDb: { query: jest.fn().mockResolvedValue({ rows: [] }) },
      getPool: jest.fn(),
      autoReturnFn: jest.fn().mockResolvedValue([]),
      findRemindFn: jest.fn().mockResolvedValue([]),
      sendRemindersFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
    });
    try {
      expect(handle.started).toBe(true);
      expect(handle.mode).toBe('multi-tenant');
    } finally {
      handle.stop();
    }
  });
});
