'use strict';

// Phase 5 — packageSlaRunner unit tests.
// Spec: packages-v2-spec.md §5 (SLA reminders + manual follow-up/alerts).

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
// candidate queries
// ══════════════════════════════════════════════════════════════════════════════

describe('findRemindCandidates', () => {
  test('throws if followupDays <= remindDays', async () => {
    const { findRemindCandidates } = loadRunner();
    await expect(
      findRemindCandidates({ query: jest.fn() }, { remindDays: 7, followupDays: 7 }),
    ).rejects.toThrow(/followupDays must be/);
    await expect(
      findRemindCandidates({ query: jest.fn() }, { remindDays: 14, followupDays: 7 }),
    ).rejects.toThrow(/followupDays must be/);
  });

  test('selects awaiting_pickup in reminder window and excludes already-reminded', async () => {
    const { findRemindCandidates, PICKUP_REMINDER_EVENT_TYPE } = loadRunner();
    const rows = [{ id: 'p1', property_id: 'prop' }];
    const query = jest.fn().mockResolvedValue({ rows });

    const result = await findRemindCandidates(
      { query },
      { remindDays: 7, followupDays: 14, batchSize: 50 },
    );

    expect(result).toEqual(rows);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/FROM packages_v2/);
    expect(sql).toMatch(/status = 'awaiting_pickup'/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/notifications_outbox/);
    expect(sql).toMatch(/event_type = \$4/);
    expect(args).toEqual(['7', '14', 50, PICKUP_REMINDER_EVENT_TYPE]);
  });
});

describe('follow-up and admin-alert candidates', () => {
  test('findFollowupCandidates selects 14-30 day packages', async () => {
    const { findFollowupCandidates, FOLLOWUP_EVENT_TYPE } = loadRunner();
    const rows = [{ id: 'p2', property_id: 'prop' }];
    const query = jest.fn().mockResolvedValue({ rows });

    const result = await findFollowupCandidates(
      { query },
      { followupDays: 14, adminAlertDays: 30, batchSize: 25 },
    );

    expect(result).toEqual(rows);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/received_at < NOW\(\) - \(\$1 \|\| ' days'\)::INTERVAL/);
    expect(sql).toMatch(/received_at >= NOW\(\) - \(\$2 \|\| ' days'\)::INTERVAL/);
    expect(sql).toMatch(/event_type = \$4/);
    expect(args).toEqual(['14', '30', 25, FOLLOWUP_EVENT_TYPE]);
  });

  test('findFollowupCandidates rejects inverted alert threshold', async () => {
    const { findFollowupCandidates } = loadRunner();
    await expect(
      findFollowupCandidates({ query: jest.fn() }, { followupDays: 14, adminAlertDays: 14 }),
    ).rejects.toThrow(/adminAlertDays must be/);
  });

  test('findAdminAlertCandidates selects packages older than adminAlertDays', async () => {
    const { findAdminAlertCandidates, ADMIN_ALERT_EVENT_TYPE } = loadRunner();
    const rows = [{ id: 'p3', property_id: 'prop' }];
    const query = jest.fn().mockResolvedValue({ rows });

    const result = await findAdminAlertCandidates(
      { query },
      { adminAlertDays: 30, batchSize: 10 },
    );

    expect(result).toEqual(rows);
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/received_at < NOW\(\) - \(\$1 \|\| ' days'\)::INTERVAL/);
    expect(sql).toMatch(/event_type = \$4/);
    expect(args).toEqual(['30', 'admin_alert', 10, ADMIN_ALERT_EVENT_TYPE]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// producers
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

  test('swallows per-package errors', async () => {
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

describe('sendStaffEscalations', () => {
  function makeClient(staffRows = [{ id: 's1', role: 'concierge' }]) {
    return {
      release: jest.fn(),
      query: jest.fn((sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }
        if (/FROM staff_users/.test(sql)) return Promise.resolve({ rows: staffRows });
        return Promise.resolve({ rows: [] });
      }),
    };
  }

  test('enqueues one staff web_push batch per package', async () => {
    const { sendStaffEscalations, FOLLOWUP_EVENT_TYPE } = loadRunner();
    const client = makeClient();
    const pool = { connect: jest.fn(async () => client) };
    const enqueueBatchFn = jest.fn(async () => [{ id: 'o1' }]);

    const stats = await sendStaffEscalations(
      pool,
      [{
        id: 'pkg-1',
        property_id: 'prop-1',
        unit_id: 'unit-1',
        received_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        carrier: 'CDEK',
      }],
      {
        eventType: FOLLOWUP_EVENT_TYPE,
        roles: ['concierge'],
        title: 'T',
        body: 'B',
        enqueueBatchFn,
      },
    );

    expect(stats).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const params = enqueueBatchFn.mock.calls[0][1];
    expect(params[0]).toMatchObject({
      propertyId: 'prop-1',
      eventType: FOLLOWUP_EVENT_TYPE,
      channel: 'web_push',
      recipientType: 'staff',
      recipientId: 's1',
      correlationId: 'pkg-1',
    });
    expect(params[0].payload).toMatchObject({
      title: 'T',
      body: 'B',
      package_id: 'pkg-1',
      carrier: 'CDEK',
      recipient_role: 'concierge',
    });
  });

  test('skips package when no active staff recipients exist', async () => {
    const { sendStaffEscalations, ADMIN_ALERT_EVENT_TYPE } = loadRunner();
    const client = makeClient([]);
    const pool = { connect: jest.fn(async () => client) };
    const enqueueBatchFn = jest.fn(async () => [{ id: 'o1' }]);

    const stats = await sendStaffEscalations(
      pool,
      [{ id: 'pkg-2', property_id: 'prop-1' }],
      {
        eventType: ADMIN_ALERT_EVENT_TYPE,
        roles: ['property_admin'],
        title: 'T',
        body: 'B',
        enqueueBatchFn,
      },
    );

    expect(stats).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(enqueueBatchFn).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tick orchestration
// ══════════════════════════════════════════════════════════════════════════════

describe('tickSingleTenant', () => {
  test('runs reminder, follow-up, and admin alert without auto-return', async () => {
    const { tickSingleTenant, FOLLOWUP_EVENT_TYPE, ADMIN_ALERT_EVENT_TYPE } = loadRunner();

    const calls = [];
    const findRemindFn = jest.fn(async () => {
      calls.push('findRemind');
      return [{ id: 'r1' }];
    });
    const sendRemindersFn = jest.fn(async () => {
      calls.push('sendReminders');
      return { sent: 1, skipped: 0, failed: 0 };
    });
    const findFollowupFn = jest.fn(async () => {
      calls.push('findFollowup');
      return [{ id: 'f1' }];
    });
    const findAdminAlertFn = jest.fn(async () => {
      calls.push('findAdminAlert');
      return [{ id: 'a1' }];
    });
    const sendStaffEscalationsFn = jest.fn(async (_pool, candidates, opts) => {
      calls.push(opts.eventType);
      return { sent: candidates.length, skipped: 0, failed: 0 };
    });

    const stats = await tickSingleTenant({}, {
      findRemindFn,
      sendRemindersFn,
      findFollowupFn,
      findAdminAlertFn,
      sendStaffEscalationsFn,
    });

    expect(calls).toEqual([
      'findRemind',
      'sendReminders',
      'findFollowup',
      FOLLOWUP_EVENT_TYPE,
      'findAdminAlert',
      ADMIN_ALERT_EVENT_TYPE,
    ]);
    expect(stats).toEqual({
      autoReturned: 0,
      reminded: 1,
      followups: 1,
      adminAlerts: 1,
      skipped: 0,
      failed: 0,
    });
  });
});

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
    const findRemindFn = jest.fn(async (pool) => {
      if (pool._slug === 'broken') throw new Error('schema drift');
      return [];
    });
    const sendRemindersFn = jest.fn(async () => ({ sent: 0, skipped: 0, failed: 0 }));
    const findFollowupFn = jest.fn(async () => []);
    const findAdminAlertFn = jest.fn(async () => []);
    const sendStaffEscalationsFn = jest.fn(async () => ({ sent: 0, skipped: 0, failed: 0 }));

    const results = await tickAllProperties({
      platformDb,
      getPool,
      findRemindFn,
      sendRemindersFn,
      findFollowupFn,
      findAdminAlertFn,
      sendStaffEscalationsFn,
    });

    expect(results).toHaveLength(3);
    expect(results[1]).toMatchObject({ slug: 'broken', error: 'schema drift' });
    expect(results[2]).toMatchObject({ slug: 'gamma', autoReturned: 0, followups: 0 });
    expect(findRemindFn).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// startPackageSlaRunner
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
      findRemindFn: jest.fn().mockResolvedValue([]),
      sendRemindersFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
      findFollowupFn: jest.fn().mockResolvedValue([]),
      findAdminAlertFn: jest.fn().mockResolvedValue([]),
      sendStaffEscalationsFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
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
      findRemindFn: jest.fn().mockResolvedValue([]),
      sendRemindersFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
      findFollowupFn: jest.fn().mockResolvedValue([]),
      findAdminAlertFn: jest.fn().mockResolvedValue([]),
      sendStaffEscalationsFn: jest.fn().mockResolvedValue({ sent: 0, skipped: 0, failed: 0 }),
    });
    try {
      expect(handle.started).toBe(true);
      expect(handle.mode).toBe('multi-tenant');
    } finally {
      handle.stop();
    }
  });
});
