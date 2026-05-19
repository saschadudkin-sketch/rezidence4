'use strict';

/**
 * Phase 5 (platform-v1) — notificationLog READ service unit tests.
 * Spec: docs/product/specs/platform-v1/notification-log-v2-spec.md §3.
 *
 * Scope:
 *   • trimPayloadForResident — whitelist leak-free; ignores unknown fields.
 *   • clampLimit            — default/floor/cap semantics.
 *   • listForTenant         — SQL shape, WHERE-clause assembly, allowlist
 *                             guard on enum filters, limit/offset clamped.
 *   • getById               — null when empty, row when present.
 *   • listForResident       — hardcoded recipient_type='resident' +
 *                             status='sent' (spec §7.Q7), payload trimmed.
 *   • resolveResidentByUid  — SELECT id FROM residents WHERE external_uid,
 *                             null on miss, null on empty uid.
 *   • getMetrics            — 3 separate queries, success_rate=null when
 *                             total=0, hoursBack validation.
 */

const { describe, test, expect } = require('@jest/globals');
const {
  listForTenant,
  getById,
  listForResident,
  resolveResidentByUid,
  getMetrics,
  trimPayloadForResident,
  clampLimit,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  ALLOWED_CHANNELS,
  ALLOWED_STATUSES,
  ALLOWED_RECIPIENT_TYPES,
} = require('../v1/services/notificationLog');

// ══════════════════════════════════════════════════════════════════════════════
// trimPayloadForResident — whitelist semantics
// ══════════════════════════════════════════════════════════════════════════════

describe('trimPayloadForResident', () => {
  test('returns empty object for null/undefined/non-object input', () => {
    expect(trimPayloadForResident(null)).toEqual({});
    expect(trimPayloadForResident(undefined)).toEqual({});
    expect(trimPayloadForResident('string-payload')).toEqual({});
    expect(trimPayloadForResident(42)).toEqual({});
  });

  test('keeps only whitelisted keys (title, body, url, locale, action, icon, message)', () => {
    const raw = {
      title: 'Посылка готова',
      body: 'Забирайте с ресепшн',
      url: '/packages/123',
      locale: 'ru',
      action: 'view',
      icon: '/icon.png',
      message: 'fallback',
      // internals that MUST be stripped:
      subscription_id: 'sub-internal',
      endpoint: 'https://fcm.googleapis.com/...',
      p256dh: 'secret',
      auth: 'secret',
      telegram_chat_id: 12345,
      chat_id: 12345,
      bot_token: 'AA:BB',
    };
    const out = trimPayloadForResident(raw);
    expect(out).toEqual({
      title: 'Посылка готова',
      body: 'Забирайте с ресепшн',
      url: '/packages/123',
      locale: 'ru',
      action: 'view',
      icon: '/icon.png',
      message: 'fallback',
    });
    // Sanity — ни одно запрещённое поле не пролезло.
    expect(out).not.toHaveProperty('subscription_id');
    expect(out).not.toHaveProperty('endpoint');
    expect(out).not.toHaveProperty('p256dh');
    expect(out).not.toHaveProperty('auth');
    expect(out).not.toHaveProperty('telegram_chat_id');
    expect(out).not.toHaveProperty('bot_token');
  });

  test('omits whitelisted keys that are undefined (not set to undefined in output)', () => {
    const out = trimPayloadForResident({ title: 'x' });
    expect(Object.keys(out)).toEqual(['title']);
  });

  test('new-unknown-adapter fields silently dropped (whitelist > blacklist)', () => {
    // The whole point of whitelist: a future adapter that adds raw-response or
    // correlation_secret field will NOT leak to resident.
    const out = trimPayloadForResident({
      title: 'ok',
      apn_priority: 10,
      raw_provider_response: { status: 200, secret_token: 'leak-me' },
    });
    expect(out).toEqual({ title: 'ok' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clampLimit
// ══════════════════════════════════════════════════════════════════════════════

describe('clampLimit', () => {
  test('returns default when raw is undefined/null/garbage', () => {
    expect(clampLimit(undefined)).toBe(LIMIT_DEFAULT);
    expect(clampLimit(null)).toBe(LIMIT_DEFAULT);
    expect(clampLimit('abc')).toBe(LIMIT_DEFAULT);
    expect(clampLimit(NaN)).toBe(LIMIT_DEFAULT);
  });

  test('returns default when raw <= 0', () => {
    expect(clampLimit(0)).toBe(LIMIT_DEFAULT);
    expect(clampLimit(-5)).toBe(LIMIT_DEFAULT);
  });

  test('floors fractional values', () => {
    expect(clampLimit(10.9)).toBe(10);
  });

  test('caps at LIMIT_MAX', () => {
    expect(clampLimit(LIMIT_MAX)).toBe(LIMIT_MAX);
    expect(clampLimit(LIMIT_MAX + 50)).toBe(LIMIT_MAX);
    expect(clampLimit(10_000)).toBe(LIMIT_MAX);
  });

  test('respects custom default', () => {
    expect(clampLimit(undefined, 25)).toBe(25);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// allowlist constants — sanity
// ══════════════════════════════════════════════════════════════════════════════

describe('allowlist constants', () => {
  test('ALLOWED_CHANNELS matches canonical 5 channels', () => {
    expect([...ALLOWED_CHANNELS].sort()).toEqual(
      ['email', 'sms', 'telegram', 'web_push', 'webhook'],
    );
  });

  test('ALLOWED_STATUSES is exactly {sent, failed} (no pending/in_flight — those are outbox-only)', () => {
    expect([...ALLOWED_STATUSES].sort()).toEqual(['failed', 'sent']);
  });

  test('ALLOWED_RECIPIENT_TYPES covers 4 canonical types', () => {
    expect([...ALLOWED_RECIPIENT_TYPES].sort()).toEqual(
      ['contractor', 'external', 'resident', 'staff'],
    );
  });

  test('LIMIT_DEFAULT=50, LIMIT_MAX=500', () => {
    expect(LIMIT_DEFAULT).toBe(50);
    expect(LIMIT_MAX).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForTenant — SQL shape + filters
// ══════════════════════════════════════════════════════════════════════════════

describe('listForTenant', () => {
  test('no filters → no WHERE, default limit, offset 0', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const out = await listForTenant(pool, {});
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/SELECT[\s\S]+FROM\s+notification_log_v2/i);
    expect(sql).not.toMatch(/WHERE/i);
    expect(sql).toMatch(/ORDER BY created_at DESC/i);
    expect(sql).toMatch(/LIMIT \$1 OFFSET \$2/i);
    expect(args).toEqual([LIMIT_DEFAULT, 0]);
    expect(out).toEqual({ rows: [], limit: LIMIT_DEFAULT, offset: 0 });
  });

  test('applies recipient_id filter', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'r1' }] }) };
    await listForTenant(pool, { recipient_id: 'uuid-abc' });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE recipient_id = \$1/);
    expect(args[0]).toBe('uuid-abc');
  });

  test('applies propertyId as first scope filter', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, {
      propertyId: 'property-1',
      recipient_id: 'uuid-abc',
      limit: 10,
    });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE property_id = \$1 AND recipient_id = \$2/);
    expect(sql).toMatch(/LIMIT \$3 OFFSET \$4/);
    expect(args).toEqual(['property-1', 'uuid-abc', 10, 0]);
  });

  test('applies channel filter only when in ALLOWED_CHANNELS', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, { channel: 'web_push' });
    expect(pool.query.mock.calls[0][0]).toMatch(/channel = \$1/);

    pool.query.mockClear();
    await listForTenant(pool, { channel: 'pigeon' });
    // Bogus channel → filter silently dropped, no channel clause.
    expect(pool.query.mock.calls[0][0]).not.toMatch(/channel\s*=/);
  });

  test('applies status filter only when in ALLOWED_STATUSES', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, { status: 'sent' });
    expect(pool.query.mock.calls[0][0]).toMatch(/status = \$1/);

    pool.query.mockClear();
    await listForTenant(pool, { status: 'pending' });
    // pending is outbox-only — не пускаем в фильтр log_v2.
    expect(pool.query.mock.calls[0][0]).not.toMatch(/status\s*=/);
  });

  test('applies recipient_type filter only when in ALLOWED_RECIPIENT_TYPES', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, { recipient_type: 'resident' });
    expect(pool.query.mock.calls[0][0]).toMatch(/recipient_type = \$1/);

    pool.query.mockClear();
    await listForTenant(pool, { recipient_type: 'alien' });
    expect(pool.query.mock.calls[0][0]).not.toMatch(/recipient_type\s*=/);
  });

  test('applies since/until filters when valid ISO', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, {
      since: '2026-04-01T00:00:00Z',
      until: '2026-04-23T23:59:59Z',
    });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/created_at >= \$1/);
    expect(sql).toMatch(/created_at <= \$2/);
    expect(args[0]).toBe('2026-04-01T00:00:00Z');
    expect(args[1]).toBe('2026-04-23T23:59:59Z');
  });

  test('ignores bogus ISO in since/until', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, { since: 'not-a-date', until: 'garbage' });
    expect(pool.query.mock.calls[0][0]).not.toMatch(/created_at\s*[<>]=/);
  });

  test('combines multiple filters with AND in numeric-placeholder order', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForTenant(pool, {
      recipient_type: 'resident',
      channel: 'sms',
      status: 'sent',
      since: '2026-04-01T00:00:00Z',
    });
    const [sql, args] = pool.query.mock.calls[0];
    // 4 filter clauses → $1..$4, then limit=$5, offset=$6.
    expect(sql).toMatch(/WHERE recipient_type = \$1 AND channel = \$2 AND status = \$3 AND created_at >= \$4/);
    expect(sql).toMatch(/LIMIT \$5 OFFSET \$6/);
    expect(args).toEqual([
      'resident', 'sms', 'sent', '2026-04-01T00:00:00Z',
      LIMIT_DEFAULT, 0,
    ]);
  });

  test('clamps limit to LIMIT_MAX and coerces offset to non-negative integer', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const out = await listForTenant(pool, { limit: 99_999, offset: -10 });
    expect(out.limit).toBe(LIMIT_MAX);
    expect(out.offset).toBe(0);
  });

  test('returns rows + actual limit/offset used', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'a' }, { id: 'b' }],
    }) };
    const out = await listForTenant(pool, { limit: 10, offset: 20 });
    expect(out).toEqual({
      rows: [{ id: 'a' }, { id: 'b' }],
      limit: 10,
      offset: 20,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getById
// ══════════════════════════════════════════════════════════════════════════════

describe('getById', () => {
  test('returns row when found', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'xyz', channel: 'sms', status: 'sent' }],
    }) };
    const row = await getById(pool, 'xyz');
    expect(row).toEqual({ id: 'xyz', channel: 'sms', status: 'sent' });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM notification_log_v2 WHERE id = \$1/);
    expect(args).toEqual(['xyz']);
  });

  test('uses propertyId scope when provided', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'xyz', property_id: 'property-1' }],
    }) };
    await getById(pool, 'xyz', { propertyId: 'property-1' });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND property_id = \$2/);
    expect(args).toEqual(['xyz', 'property-1']);
  });

  test('returns null on empty result', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const row = await getById(pool, 'missing');
    expect(row).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForResident — hardcoded filters + payload trimming
// ══════════════════════════════════════════════════════════════════════════════

describe('listForResident', () => {
  test('empty array when residentId falsy (no DB call)', async () => {
    const pool = { query: jest.fn() };
    expect(await listForResident(pool, null)).toEqual([]);
    expect(await listForResident(pool, '')).toEqual([]);
    expect(await listForResident(pool, undefined)).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('hardcodes recipient_type=resident + status=sent (spec §7.Q7)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForResident(pool, 'resident-uuid');
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/recipient_type = 'resident'/);
    expect(sql).toMatch(/recipient_id = \$1/);
    expect(sql).toMatch(/status = 'sent'/);
    expect(sql).toMatch(/ORDER BY created_at DESC/i);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(args[0]).toBe('resident-uuid');
    expect(args[1]).toBe(LIMIT_DEFAULT);
  });

  test('scopes resident list by propertyId when provided', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForResident(pool, 'resident-uuid', { propertyId: 'property-1', limit: 5 });
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/AND property_id = \$2/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(args).toEqual(['resident-uuid', 'property-1', 5]);
  });

  test('sensitive columns excluded from SELECT (provider_message_id, error_message)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForResident(pool, 'r1');
    const sql = pool.query.mock.calls[0][0];
    // These columns MUST NOT be selected for /mine.
    expect(sql).not.toMatch(/provider_message_id/);
    expect(sql).not.toMatch(/error_message/);
  });

  test('trims payload on every row via trimPayloadForResident', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [
      {
        id: 'a',
        channel: 'web_push',
        event_type: 'visit_arrived',
        status: 'sent',
        payload: { title: 'ok', body: 'text', endpoint: 'SECRET-FCM-URL', p256dh: 'LEAK' },
        attempt_count: 1,
      },
      {
        id: 'b',
        channel: 'sms',
        event_type: 'booking_confirmed',
        status: 'sent',
        payload: { title: 'hi', bot_token: 'STRIP-ME' },
      },
    ] }) };
    const out = await listForResident(pool, 'r1');
    expect(out[0].payload).toEqual({ title: 'ok', body: 'text' });
    expect(out[1].payload).toEqual({ title: 'hi' });
    // Other columns untouched.
    expect(out[0].id).toBe('a');
    expect(out[0].channel).toBe('web_push');
  });

  test('respects custom limit through clampLimit', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await listForResident(pool, 'r1', { limit: 10 });
    expect(pool.query.mock.calls[0][1][1]).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveResidentByUid
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveResidentByUid', () => {
  test('returns null for falsy uid without hitting DB', async () => {
    const pool = { query: jest.fn() };
    expect(await resolveResidentByUid(pool, '')).toBeNull();
    expect(await resolveResidentByUid(pool, null)).toBeNull();
    expect(await resolveResidentByUid(pool, undefined)).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns residents.id on hit', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'resident-uuid-123' }],
    }) };
    const id = await resolveResidentByUid(pool, 'legacy-uid-abc');
    expect(id).toBe('resident-uuid-123');
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM residents WHERE external_uid = \$1 LIMIT 1/);
    expect(args).toEqual(['legacy-uid-abc']);
  });

  test('scopes resident uid lookup by propertyId when provided', async () => {
    const pool = { query: jest.fn().mockResolvedValue({
      rows: [{ id: 'resident-uuid-123' }],
    }) };
    const id = await resolveResidentByUid(pool, 'legacy-uid-abc', { propertyId: 'property-1' });
    expect(id).toBe('resident-uuid-123');
    const [sql, args] = pool.query.mock.calls[0];
    expect(sql).toMatch(/WHERE external_uid = \$1 AND property_id = \$2 LIMIT 1/);
    expect(args).toEqual(['legacy-uid-abc', 'property-1']);
  });

  test('returns null when no residents row for uid (legacy pre-Phase-7 user)', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const id = await resolveResidentByUid(pool, 'legacy-only-uid');
    expect(id).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getMetrics
// ══════════════════════════════════════════════════════════════════════════════

describe('getMetrics', () => {
  test('throws on non-positive hoursBack', async () => {
    const pool = { query: jest.fn() };
    await expect(getMetrics(pool, 0)).rejects.toThrow(/positive/);
    await expect(getMetrics(pool, -24)).rejects.toThrow(/positive/);
    await expect(getMetrics(pool, 'abc')).rejects.toThrow(/positive/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('runs 3 queries with NOW() - $1::interval across all of them', async () => {
    const pool = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const snap = await getMetrics(pool, 24);
    expect(pool.query).toHaveBeenCalledTimes(3);
    for (const call of pool.query.mock.calls) {
      expect(call[0]).toMatch(/created_at >= NOW\(\) - \$1::interval/);
      expect(call[1]).toEqual(['24 hours']);
    }
    expect(snap.period_hours).toBe(24);
    expect(snap.channels).toEqual([]);
    expect(snap.top_events).toEqual([]);
    expect(snap.top_errors).toEqual([]);
    expect(typeof snap.generated_at).toBe('string');
  });

  test('computes per-channel success_rate correctly', async () => {
    const pool = { query: jest.fn()
      // channels
      .mockResolvedValueOnce({ rows: [
        { channel: 'sms',      sent: '90', failed: '10' },
        { channel: 'telegram', sent: '50', failed:  '0' },
        { channel: 'email',    sent:  '0', failed:  '0' }, // edge: zero total
      ] })
      // events
      .mockResolvedValueOnce({ rows: [{ event_type: 'visit_arrived', total: 42 }] })
      // errors
      .mockResolvedValueOnce({ rows: [{ error_code: 'CONN_RESET', total: 7 }] }),
    };
    const snap = await getMetrics(pool, 168);
    expect(snap.period_hours).toBe(168);
    expect(snap.channels).toEqual([
      { channel: 'sms',      sent: 90, failed: 10, success_rate: 0.9 },
      { channel: 'telegram', sent: 50, failed:  0, success_rate: 1   },
      { channel: 'email',    sent:  0, failed:  0, success_rate: null },
    ]);
    expect(snap.top_events).toEqual([{ event_type: 'visit_arrived', total: 42 }]);
    expect(snap.top_errors).toEqual([{ error_code: 'CONN_RESET',    total:  7 }]);
  });

  test('top_events query has LIMIT 10 + ORDER BY total DESC', async () => {
    const pool = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    await getMetrics(pool, 720);
    const evSql = pool.query.mock.calls[1][0];
    expect(evSql).toMatch(/GROUP BY event_type/i);
    expect(evSql).toMatch(/ORDER BY total DESC/i);
    expect(evSql).toMatch(/LIMIT 10/i);
  });

  test('top_errors query filters status=failed AND error_code IS NOT NULL', async () => {
    const pool = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    await getMetrics(pool, 24);
    const errSql = pool.query.mock.calls[2][0];
    expect(errSql).toMatch(/status = 'failed'/i);
    expect(errSql).toMatch(/error_code IS NOT NULL/i);
    expect(errSql).toMatch(/GROUP BY error_code/i);
    expect(errSql).toMatch(/LIMIT 10/i);
  });

  test('scopes all metrics queries by propertyId when provided', async () => {
    const pool = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    await getMetrics(pool, 24, { propertyId: 'property-1' });
    for (const [sql, args] of pool.query.mock.calls) {
      expect(sql).toMatch(/created_at >= NOW\(\) - \$1::interval AND property_id = \$2/);
      expect(args).toEqual(['24 hours', 'property-1']);
    }
  });
});
