'use strict';

/**
 * Phase 5 — admin/outbox service unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.2.
 *
 * Scope:
 *   • constants: LIMIT_DEFAULT/MAX, ALLOWED_STATUSES/CHANNELS, ordering arrays.
 *   • clampLimit: bounds, invalid inputs.
 *   • isValidUuid / isValidIso.
 *   • listOutbox: фильтры (status/channel/from/to/q), offset/limit, пустой WHERE.
 *   • getOutboxById: row / null, SQL shape.
 *   • requeueOutboxRow: revived / not_found / not_retryable (sent, pending, in_flight).
 *   • cancelOutboxRow: cancelled / not_found / not_cancellable.
 *   • getOutboxMetrics: snapshot shape, per-channel fill-all-5,
 *     oldest_pending_age_seconds null-handling, Math.round.
 *   • renderMetricsAsPrometheus: HELP/TYPE lines, per-status gauge families,
 *     property label, oldest_pending без channel label, escapeLabel.
 */

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// ── jest.mock outboxRetry, чтобы тесты на requeueOutboxRow могли контролировать
// вывод resurrectOutboxRows без поднятия всей SQL-логики.
jest.mock('../v1/services/outboxRetry', () => ({
  resurrectOutboxRows: jest.fn(),
}));

const { resurrectOutboxRows } = require('../v1/services/outboxRetry');

const {
  listOutbox,
  getOutboxById,
  requeueOutboxRow,
  cancelOutboxRow,
  getOutboxMetrics,
  renderMetricsAsPrometheus,
  escapeLabel,
  clampLimit,
  isValidUuid,
  isValidIso,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  ALLOWED_STATUSES,
  ALLOWED_CHANNELS,
  CHANNELS_ORDERED,
  STATUSES_ORDERED,
  OUTBOX_COLUMNS,
} = require('../v1/services/adminOutbox');

// ── Mock pool helper: dispatch queries через массив handlers в порядке вызова.
// Каждый handler получает (sql, args) и должен вернуть { rows } или выбросить.
function makeDb(handlers = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: jest.fn(async (sql, args) => {
      calls.push({ sql, args });
      const h = handlers[i++];
      if (!h) throw new Error(`unexpected query #${i}: ${sql}`);
      if (typeof h === 'function') return h(sql, args);
      return h;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

describe('constants', () => {
  test('LIMIT_DEFAULT=100, LIMIT_MAX=500', () => {
    expect(LIMIT_DEFAULT).toBe(100);
    expect(LIMIT_MAX).toBe(500);
  });

  test('ALLOWED_STATUSES matches migration 016 enum', () => {
    expect(ALLOWED_STATUSES).toBeInstanceOf(Set);
    for (const s of ['pending', 'in_flight', 'sent', 'failed', 'dead']) {
      expect(ALLOWED_STATUSES.has(s)).toBe(true);
    }
    expect(ALLOWED_STATUSES.size).toBe(5);
  });

  test('ALLOWED_CHANNELS matches migration 016 enum', () => {
    for (const c of ['web_push', 'sms', 'telegram', 'webhook', 'email']) {
      expect(ALLOWED_CHANNELS.has(c)).toBe(true);
    }
    expect(ALLOWED_CHANNELS.size).toBe(5);
  });

  test('CHANNELS_ORDERED — stable order for Prometheus diff-friendly output', () => {
    expect(CHANNELS_ORDERED).toEqual(['web_push', 'sms', 'telegram', 'webhook', 'email']);
  });

  test('STATUSES_ORDERED — stable order', () => {
    expect(STATUSES_ORDERED).toEqual(['pending', 'in_flight', 'sent', 'failed', 'dead']);
  });

  test('OUTBOX_COLUMNS includes key observability fields', () => {
    // Основные поля, которые admin UI должен видеть.
    for (const col of [
      'id', 'event_type', 'channel', 'recipient_type', 'recipient_id',
      'payload', 'status', 'attempt_count', 'max_attempts',
      'last_attempted_at', 'last_error', 'sent_at', 'correlation_id',
    ]) {
      expect(OUTBOX_COLUMNS).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clampLimit
// ══════════════════════════════════════════════════════════════════════════════

describe('clampLimit', () => {
  test('default when input is undefined', () => {
    expect(clampLimit(undefined)).toBe(LIMIT_DEFAULT);
  });

  test('default when input is non-numeric string', () => {
    expect(clampLimit('abc')).toBe(LIMIT_DEFAULT);
  });

  test('default when input <= 0', () => {
    expect(clampLimit(0)).toBe(LIMIT_DEFAULT);
    expect(clampLimit(-10)).toBe(LIMIT_DEFAULT);
  });

  test('floor numeric input', () => {
    expect(clampLimit('42.7')).toBe(42);
    expect(clampLimit(42.9)).toBe(42);
  });

  test('caps at LIMIT_MAX', () => {
    expect(clampLimit(10000)).toBe(LIMIT_MAX);
    expect(clampLimit(LIMIT_MAX + 1)).toBe(LIMIT_MAX);
  });

  test('custom default respected', () => {
    expect(clampLimit(undefined, 42)).toBe(42);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isValidUuid / isValidIso
// ══════════════════════════════════════════════════════════════════════════════

describe('isValidUuid', () => {
  test('valid UUID v4-like', () => {
    expect(isValidUuid('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isValidUuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });
  test('rejects garbage / non-string', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
  });
});

describe('isValidIso', () => {
  test('valid ISO strings', () => {
    expect(isValidIso('2026-04-23T12:00:00.000Z')).toBe(true);
    expect(isValidIso('2026-01-01')).toBe(true);
  });
  test('invalid', () => {
    expect(isValidIso('not a date')).toBe(false);
    expect(isValidIso('')).toBe(false);
    expect(isValidIso(null)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listOutbox
// ══════════════════════════════════════════════════════════════════════════════

describe('listOutbox', () => {
  test('no filters → empty WHERE, default limit/offset', async () => {
    const db = makeDb([{ rows: [{ id: 'r1' }] }]);
    const out = await listOutbox(db, {});
    expect(out.rows).toEqual([{ id: 'r1' }]);
    expect(out.limit).toBe(LIMIT_DEFAULT);
    expect(out.offset).toBe(0);

    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/FROM\s+notifications_outbox/i);
    expect(sql).not.toMatch(/WHERE/i);  // пустые фильтры → без WHERE
    expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC/i);
    expect(args).toEqual([LIMIT_DEFAULT, 0]);
  });

  test('status filter → status = $1', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { status: 'pending' });
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/WHERE\s+status = \$1/);
    expect(args[0]).toBe('pending');
  });

  test('invalid status silently ignored (defensive)', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { status: 'garbage' });
    const { sql } = db.calls[0];
    expect(sql).not.toMatch(/WHERE/i);
  });

  test('channel filter', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { channel: 'telegram' });
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/WHERE\s+channel = \$1/);
    expect(args[0]).toBe('telegram');
  });

  test('invalid channel silently ignored', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { channel: 'fax' });
    const { sql } = db.calls[0];
    expect(sql).not.toMatch(/WHERE/i);
  });

  test('from/to applied to created_at', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, {
      from: '2026-04-01T00:00:00Z',
      to:   '2026-04-30T23:59:59Z',
    });
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/created_at >= \$1/);
    expect(sql).toMatch(/created_at <= \$2/);
    expect(args[0]).toBe('2026-04-01T00:00:00Z');
    expect(args[1]).toBe('2026-04-30T23:59:59Z');
  });

  test('invalid from/to silently ignored', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { from: 'not-a-date', to: 'also-bad' });
    const { sql } = db.calls[0];
    expect(sql).not.toMatch(/WHERE/i);
  });

  test('q filter → ILIKE по event_type, correlation_id, recipient_address', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { q: 'guest' });
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/event_type ILIKE \$1/);
    expect(sql).toMatch(/correlation_id::text ILIKE \$1/);
    expect(sql).toMatch(/recipient_address ILIKE \$1/);
    expect(args[0]).toBe('%guest%');
  });

  test('q blank ignored', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { q: '   ' });
    const { sql } = db.calls[0];
    expect(sql).not.toMatch(/ILIKE/);
  });

  test('q truncated to 200 chars', async () => {
    const db = makeDb([{ rows: [] }]);
    const big = 'a'.repeat(500);
    await listOutbox(db, { q: big });
    const { args } = db.calls[0];
    // 200-char body wrapped in %...%
    expect(args[0]).toBe(`%${'a'.repeat(200)}%`);
  });

  test('combined filters use incrementing $N', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, {
      status: 'failed',
      channel: 'sms',
      from: '2026-04-01',
      to: '2026-04-30',
      q: 'timeout',
    });
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/status = \$1/);
    expect(sql).toMatch(/channel = \$2/);
    expect(sql).toMatch(/created_at >= \$3/);
    expect(sql).toMatch(/created_at <= \$4/);
    expect(sql).toMatch(/event_type ILIKE \$5/);
    expect(args.slice(0, 5)).toEqual([
      'failed', 'sms', '2026-04-01', '2026-04-30', '%timeout%',
    ]);
    // limit/offset всегда последние два.
    expect(args[args.length - 2]).toBe(LIMIT_DEFAULT);
    expect(args[args.length - 1]).toBe(0);
  });

  test('custom limit/offset respected and clamped', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { limit: 10000, offset: 50 });
    const { args } = db.calls[0];
    expect(args[args.length - 2]).toBe(LIMIT_MAX);
    expect(args[args.length - 1]).toBe(50);
  });

  test('negative offset floored to 0', async () => {
    const db = makeDb([{ rows: [] }]);
    await listOutbox(db, { offset: -100 });
    const { args } = db.calls[0];
    expect(args[args.length - 1]).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getOutboxById
// ══════════════════════════════════════════════════════════════════════════════

describe('getOutboxById', () => {
  test('returns the row when found', async () => {
    const row = { id: 'id-1', status: 'dead' };
    const db = makeDb([{ rows: [row] }]);
    const out = await getOutboxById(db, 'id-1');
    expect(out).toBe(row);
    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/FROM notifications_outbox/i);
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(args).toEqual(['id-1']);
  });

  test('returns null when not found', async () => {
    const db = makeDb([{ rows: [] }]);
    const out = await getOutboxById(db, 'missing');
    expect(out).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// requeueOutboxRow
// ══════════════════════════════════════════════════════════════════════════════

describe('requeueOutboxRow', () => {
  test('not_found → conflict not_found, resurrect NOT called', async () => {
    const db = makeDb([{ rows: [] }]);  // getOutboxById returns none
    const out = await requeueOutboxRow(db, 'missing');
    expect(out).toEqual({ revived: false, conflict: 'not_found' });
    expect(resurrectOutboxRows).not.toHaveBeenCalled();
  });

  test('existing dead row → revived=true, previousStatus propagated', async () => {
    const row = { id: 'id-1', status: 'dead' };
    const db = makeDb([{ rows: [row] }]);
    resurrectOutboxRows.mockResolvedValue({ revived: 1, revivedIds: ['id-1'] });

    const out = await requeueOutboxRow(db, 'id-1');
    expect(out).toEqual({
      revived: true,
      id: 'id-1',
      previousStatus: 'dead',
    });
    expect(resurrectOutboxRows).toHaveBeenCalledWith(db, { ids: ['id-1'] });
  });

  test('existing failed row → revived=true, previousStatus=failed', async () => {
    const db = makeDb([{ rows: [{ id: 'id-2', status: 'failed' }] }]);
    resurrectOutboxRows.mockResolvedValue({ revived: 1, revivedIds: ['id-2'] });
    const out = await requeueOutboxRow(db, 'id-2');
    expect(out.revived).toBe(true);
    expect(out.previousStatus).toBe('failed');
  });

  test('existing pending row → not_retryable conflict', async () => {
    const db = makeDb([{ rows: [{ id: 'id-3', status: 'pending' }] }]);
    resurrectOutboxRows.mockResolvedValue({ revived: 0, revivedIds: [] });
    const out = await requeueOutboxRow(db, 'id-3');
    expect(out).toEqual({
      revived: false,
      conflict: 'not_retryable',
      status: 'pending',
    });
  });

  test('existing in_flight row → not_retryable (safety: never re-queue in-flight)', async () => {
    const db = makeDb([{ rows: [{ id: 'id-4', status: 'in_flight' }] }]);
    resurrectOutboxRows.mockResolvedValue({ revived: 0, revivedIds: [] });
    const out = await requeueOutboxRow(db, 'id-4');
    expect(out.conflict).toBe('not_retryable');
    expect(out.status).toBe('in_flight');
  });

  test('existing sent row → not_retryable (already delivered)', async () => {
    const db = makeDb([{ rows: [{ id: 'id-5', status: 'sent' }] }]);
    resurrectOutboxRows.mockResolvedValue({ revived: 0, revivedIds: [] });
    const out = await requeueOutboxRow(db, 'id-5');
    expect(out.conflict).toBe('not_retryable');
    expect(out.status).toBe('sent');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cancelOutboxRow
// ══════════════════════════════════════════════════════════════════════════════

describe('cancelOutboxRow', () => {
  test('cancelled=true when UPDATE returns row', async () => {
    const updated = { id: 'id-1', status: 'dead' };
    const db = makeDb([{ rows: [updated] }]);
    const out = await cancelOutboxRow(db, 'id-1');
    expect(out).toEqual({ cancelled: true, row: updated });

    const { sql, args } = db.calls[0];
    expect(sql).toMatch(/UPDATE notifications_outbox/i);
    expect(sql).toMatch(/SET\s+status\s*=\s*'dead'/i);
    expect(sql).toMatch(/last_error\s*=\s*'cancelled_by_admin'/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*\$1/);
    expect(sql).toMatch(/AND\s+status\s+IN\s*\(\s*'pending'\s*,\s*'failed'\s*\)/i);
    expect(args).toEqual(['id-1']);
  });

  test('not_found when UPDATE empty AND getOutboxById empty', async () => {
    const db = makeDb([
      { rows: [] },  // UPDATE empty
      { rows: [] },  // SELECT empty
    ]);
    const out = await cancelOutboxRow(db, 'missing');
    expect(out).toEqual({ cancelled: false, conflict: 'not_found' });
  });

  test('not_cancellable when row exists in sent/dead/in_flight', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [{ id: 'id-1', status: 'sent' }] },
    ]);
    const out = await cancelOutboxRow(db, 'id-1');
    expect(out).toEqual({
      cancelled: false,
      conflict: 'not_cancellable',
      status: 'sent',
    });
  });

  test('not_cancellable for in_flight', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [{ id: 'id-2', status: 'in_flight' }] },
    ]);
    const out = await cancelOutboxRow(db, 'id-2');
    expect(out.status).toBe('in_flight');
  });

  test('not_cancellable for dead (already dead)', async () => {
    const db = makeDb([
      { rows: [] },
      { rows: [{ id: 'id-3', status: 'dead' }] },
    ]);
    const out = await cancelOutboxRow(db, 'id-3');
    expect(out.status).toBe('dead');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getOutboxMetrics
// ══════════════════════════════════════════════════════════════════════════════

describe('getOutboxMetrics', () => {
  test('shape: counts + per_channel (all 5 filled) + per_event_type + oldest + generated_at', async () => {
    const db = makeDb([
      // 1. aggregate counts
      {
        rows: [{
          pending: '4',
          in_flight: '1',
          sent: '100',
          failed: '2',
          dead: '0',
          oldest_pending_age_seconds: '123.7',
        }],
      },
      // 2. per-channel — только 2 из 5 каналов вернутся
      {
        rows: [
          { channel: 'web_push', pending: '3', in_flight: '0', sent: '50', failed: '1', dead: '0' },
          { channel: 'telegram', pending: '1', in_flight: '1', sent: '50', failed: '1', dead: '0' },
        ],
      },
      // 3. top events
      {
        rows: [
          { event_type: 'guest.arrived',       total: '45' },
          { event_type: 'request.approved',    total: '30' },
        ],
      },
    ]);

    const out = await getOutboxMetrics(db);

    // counts
    expect(out.counts).toEqual({
      pending: 4, in_flight: 1, sent: 100, failed: 2, dead: 0,
    });

    // per_channel должен быть дополнен до всех 5 каналов, даже нулевыми.
    expect(out.per_channel).toHaveLength(5);
    expect(out.per_channel.map((c) => c.channel)).toEqual(CHANNELS_ORDERED);

    const web = out.per_channel.find((c) => c.channel === 'web_push');
    expect(web).toEqual({
      channel: 'web_push',
      pending: 3, in_flight: 0, sent: 50, failed: 1, dead: 0,
    });

    // SMS не был в результатах → нули
    const sms = out.per_channel.find((c) => c.channel === 'sms');
    expect(sms).toEqual({
      channel: 'sms',
      pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0,
    });

    // per_event_type
    expect(out.per_event_type).toEqual([
      { event_type: 'guest.arrived',    total: 45 },
      { event_type: 'request.approved', total: 30 },
    ]);

    // oldest округлён до ближайшей секунды
    expect(out.oldest_pending_age_seconds).toBe(124);

    // generated_at — ISO
    expect(typeof out.generated_at).toBe('string');
    expect(Number.isNaN(Date.parse(out.generated_at))).toBe(false);
  });

  test('oldest_pending_age_seconds=null when queue empty', async () => {
    const db = makeDb([
      { rows: [{ pending: '0', in_flight: '0', sent: '0', failed: '0', dead: '0', oldest_pending_age_seconds: null }] },
      { rows: [] },
      { rows: [] },
    ]);
    const out = await getOutboxMetrics(db);
    expect(out.oldest_pending_age_seconds).toBeNull();
    expect(out.counts).toEqual({ pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0 });
    // per_channel всё равно все 5 — с нулями.
    expect(out.per_channel).toHaveLength(5);
    expect(out.per_event_type).toEqual([]);
  });

  test('SQL: aggregate uses FILTER (WHERE status=...) + MIN(next_attempt_at)', async () => {
    const db = makeDb([
      { rows: [{ pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0, oldest_pending_age_seconds: null }] },
      { rows: [] },
      { rows: [] },
    ]);
    await getOutboxMetrics(db);
    const agg = db.calls[0].sql;
    expect(agg).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'pending'\s*\)/i);
    expect(agg).toMatch(/FILTER\s*\(\s*WHERE\s+status\s*=\s*'dead'\s*\)/i);
    expect(agg).toMatch(/MIN\(\s*next_attempt_at\s*\)/i);
    expect(agg).toMatch(/EXTRACT\(\s*EPOCH\s+FROM/i);
  });

  test('SQL: per-channel — GROUP BY channel with FILTERs', async () => {
    const db = makeDb([
      { rows: [{ pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0, oldest_pending_age_seconds: null }] },
      { rows: [] },
      { rows: [] },
    ]);
    await getOutboxMetrics(db);
    const ch = db.calls[1].sql;
    expect(ch).toMatch(/GROUP BY\s+channel/i);
  });

  test('SQL: top events — LIMIT 10 ORDER BY total DESC', async () => {
    const db = makeDb([
      { rows: [{ pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0, oldest_pending_age_seconds: null }] },
      { rows: [] },
      { rows: [] },
    ]);
    await getOutboxMetrics(db);
    const ev = db.calls[2].sql;
    expect(ev).toMatch(/ORDER BY\s+total\s+DESC/i);
    expect(ev).toMatch(/LIMIT\s+10/);
    expect(ev).toMatch(/GROUP BY\s+event_type/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// renderMetricsAsPrometheus
// ══════════════════════════════════════════════════════════════════════════════

describe('renderMetricsAsPrometheus', () => {
  function makeSnapshot() {
    return {
      counts: { pending: 5, in_flight: 2, sent: 100, failed: 3, dead: 1 },
      per_channel: [
        { channel: 'web_push', pending: 3, in_flight: 1, sent: 50, failed: 2, dead: 0 },
        { channel: 'sms',      pending: 1, in_flight: 0, sent: 20, failed: 1, dead: 1 },
        { channel: 'telegram', pending: 1, in_flight: 1, sent: 30, failed: 0, dead: 0 },
        { channel: 'webhook',  pending: 0, in_flight: 0, sent: 0,  failed: 0, dead: 0 },
        { channel: 'email',    pending: 0, in_flight: 0, sent: 0,  failed: 0, dead: 0 },
      ],
      per_event_type: [],
      oldest_pending_age_seconds: 142,
      generated_at: '2026-04-23T12:00:00.000Z',
    };
  }

  test('trailing newline + HELP/TYPE для каждого из 5 status families', () => {
    const out = renderMetricsAsPrometheus(makeSnapshot());
    expect(out.endsWith('\n')).toBe(true);
    for (const s of STATUSES_ORDERED) {
      const name = `notifications_outbox_${s}`;
      expect(out).toMatch(new RegExp(`# HELP ${name} `));
      expect(out).toMatch(new RegExp(`# TYPE ${name} gauge`));
    }
  });

  test('per-status/per-channel sample lines include channel label', () => {
    const out = renderMetricsAsPrometheus(makeSnapshot());
    expect(out).toMatch(/notifications_outbox_pending\{channel="web_push"\} 3/);
    expect(out).toMatch(/notifications_outbox_pending\{channel="sms"\} 1/);
    expect(out).toMatch(/notifications_outbox_sent\{channel="telegram"\} 30/);
    expect(out).toMatch(/notifications_outbox_failed\{channel="web_push"\} 2/);
  });

  test('propertySlug → label property="..." для всех линий', () => {
    const out = renderMetricsAsPrometheus(makeSnapshot(), { propertySlug: 'zamosk' });
    expect(out).toMatch(/notifications_outbox_pending\{channel="web_push",property="zamosk"\} 3/);
    expect(out).toMatch(/notifications_outbox_oldest_pending_age_seconds\{property="zamosk"\} 142/);
  });

  test('oldest_pending_age_seconds=null → выводится 0 (Prometheus-friendly)', () => {
    const snap = makeSnapshot();
    snap.oldest_pending_age_seconds = null;
    const out = renderMetricsAsPrometheus(snap, { propertySlug: 'zamosk' });
    expect(out).toMatch(/notifications_outbox_oldest_pending_age_seconds\{property="zamosk"\} 0/);
  });

  test('channel lines emitted in CHANNELS_ORDERED order (diff-friendly scrape)', () => {
    const out = renderMetricsAsPrometheus(makeSnapshot());
    const pendingBlock = out.split(/# HELP notifications_outbox_pending/)[1]
      .split(/# HELP /)[0];
    const webIdx  = pendingBlock.indexOf('channel="web_push"');
    const smsIdx  = pendingBlock.indexOf('channel="sms"');
    const tgIdx   = pendingBlock.indexOf('channel="telegram"');
    const whIdx   = pendingBlock.indexOf('channel="webhook"');
    const emIdx   = pendingBlock.indexOf('channel="email"');
    expect(webIdx).toBeLessThan(smsIdx);
    expect(smsIdx).toBeLessThan(tgIdx);
    expect(tgIdx).toBeLessThan(whIdx);
    expect(whIdx).toBeLessThan(emIdx);
  });

  test('no propertySlug → label property не добавляется', () => {
    const out = renderMetricsAsPrometheus(makeSnapshot());
    // Line должна выглядеть как ..._pending{channel="web_push"} 3 без property
    expect(out).toMatch(/notifications_outbox_pending\{channel="web_push"\} 3/);
    expect(out).not.toMatch(/property="/);
  });
});

describe('escapeLabel', () => {
  test('escapes backslash, double-quote, newline', () => {
    expect(escapeLabel('simple')).toBe('simple');
    expect(escapeLabel('a"b')).toBe('a\\"b');
    expect(escapeLabel('a\\b')).toBe('a\\\\b');
    expect(escapeLabel('a\nb')).toBe('a\\nb');
  });

  test('coerces non-string to string', () => {
    expect(escapeLabel(123)).toBe('123');
    expect(escapeLabel(null)).toBe('null');
  });
});
