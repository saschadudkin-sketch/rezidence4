'use strict';

/**
 * Phase 5 — notificationOutbox producer unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.1, §7 Q3.
 *
 * Тестируем producer без реальной Postgres — фиксируем шейп INSERT'а,
 * валидацию, fan-out batch, feature-flag и backoff-формулу.  Integration
 * (tx + bulk + worker) — отдельный pg-backed tест в следующей миграции.
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestApi } = require('@jest/globals');

const {
  enqueueNotification,
  enqueueNotificationBatch,
  isOutboxEnabled,
  computeBackoffMinutes,
  VALID_CHANNELS,
  VALID_RECIPIENT_TYPES,
  BACKOFF_MINUTES,
  DEFAULT_MAX_ATTEMPTS,
} = require('../v1/services/notificationOutbox');

function makeMockTx() {
  return {
    query: jestApi.fn().mockResolvedValue({
      rows: [{
        id: 'outbox-row-uuid',
        status: 'pending',
        next_attempt_at: new Date('2026-04-23T12:00:00Z').toISOString(),
        created_at: new Date('2026-04-23T12:00:00Z').toISOString(),
      }],
    }),
  };
}

const BASE_PARAMS = {
  propertyId:       'prop-uuid',
  eventType:        'guest.arrived',
  channel:          'web_push',
  recipientType:    'resident',
  recipientId:      'resident-uuid',
  recipientAddress: '{"endpoint":"https://fcm.googleapis.com/...","p256dh":"pk","auth":"ak","subscription_id":"sub-uuid"}',
  payload:          { title: 'Гость прибыл', body: 'Иван у входа' },
  correlationId:    'visit-log-uuid',
};

describe('enqueueNotification — tx contract', () => {
  test('throws when first arg lacks .query (pool mistakenly passed as tx-less object)', async () => {
    await expect(enqueueNotification(null, BASE_PARAMS)).rejects.toThrow(
      /first arg must be a pg client/,
    );
    await expect(enqueueNotification({}, BASE_PARAMS)).rejects.toThrow(
      /first arg must be a pg client/,
    );
  });

  test('accepts any object that has .query (tx interface)', async () => {
    const tx = makeMockTx();
    const result = await enqueueNotification(tx, BASE_PARAMS);
    expect(result.id).toBe('outbox-row-uuid');
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
});

describe('enqueueNotification — validation (matches DB CHECK constraints)', () => {
  test('rejects unknown channel', async () => {
    const tx = makeMockTx();
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, channel: 'carrier_pigeon' }),
    ).rejects.toThrow(/invalid channel/);
    expect(tx.query).not.toHaveBeenCalled();
  });

  test('accepts all 5 channels from the enum', () => {
    expect([...VALID_CHANNELS].sort()).toEqual(
      ['email', 'sms', 'telegram', 'web_push', 'webhook'],
    );
  });

  test('rejects unknown recipient_type', async () => {
    const tx = makeMockTx();
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, recipientType: 'alien' }),
    ).rejects.toThrow(/invalid recipientType/);
  });

  test('accepts all 5 recipient types from the enum (incl. vehicle + external)', () => {
    expect([...VALID_RECIPIENT_TYPES].sort()).toEqual(
      ['contractor', 'external', 'resident', 'staff', 'vehicle'],
    );
  });

  test('rejects missing propertyId / eventType', async () => {
    const tx = makeMockTx();
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, propertyId: null }),
    ).rejects.toThrow(/propertyId required/);
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, eventType: '' }),
    ).rejects.toThrow(/eventType required/);
  });

  test('rejects payload that is not an object', async () => {
    const tx = makeMockTx();
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, payload: 'plain string' }),
    ).rejects.toThrow(/payload must be object/);
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, payload: null }),
    ).rejects.toThrow(/payload required/);
  });

  test('rejects non-positive maxAttempts', async () => {
    const tx = makeMockTx();
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, maxAttempts: 0 }),
    ).rejects.toThrow(/maxAttempts/);
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, maxAttempts: -3 }),
    ).rejects.toThrow(/maxAttempts/);
    await expect(
      enqueueNotification(tx, { ...BASE_PARAMS, maxAttempts: 1.5 }),
    ).rejects.toThrow(/maxAttempts/);
  });
});

describe('enqueueNotification — INSERT shape', () => {
  test('INSERT targets notifications_outbox with status=pending + attempts bookkeeping', async () => {
    const tx = makeMockTx();
    await enqueueNotification(tx, BASE_PARAMS);
    const [sql, values] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO\s+notifications_outbox/i);
    expect(sql).toMatch(/'pending'/);
    expect(sql).toMatch(/0,\s*\$8/); // attempt_count=0, max_attempts from param
    expect(sql).toMatch(/NOW\(\)/);
    // Param order matches INSERT param order.
    expect(values[0]).toBe(BASE_PARAMS.propertyId);
    expect(values[1]).toBe(BASE_PARAMS.eventType);
    expect(values[2]).toBe(BASE_PARAMS.channel);
    expect(values[3]).toBe(BASE_PARAMS.recipientType);
    expect(values[4]).toBe(BASE_PARAMS.recipientId);
    expect(values[5]).toBe(BASE_PARAMS.recipientAddress);
    // payload is JSON-stringified (JSONB column expects valid JSON).
    expect(JSON.parse(values[6])).toEqual(BASE_PARAMS.payload);
    expect(values[7]).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(values[8]).toBe(BASE_PARAMS.correlationId);
  });

  test('RETURNING clause exposes id/status/next_attempt_at/created_at', async () => {
    const tx = makeMockTx();
    await enqueueNotification(tx, BASE_PARAMS);
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/RETURNING\s+id,\s*status,\s*next_attempt_at,\s*created_at/i);
  });

  test('optional fields default to NULL when not provided', async () => {
    const tx = makeMockTx();
    const minimal = {
      propertyId:    'p',
      eventType:     'package.arrived',
      channel:       'sms',
      recipientType: 'resident',
      payload:       { message: 'SMS text' },
    };
    await enqueueNotification(tx, minimal);
    const [, values] = tx.query.mock.calls[0];
    expect(values[4]).toBeNull(); // recipientId
    expect(values[5]).toBeNull(); // recipientAddress
    expect(values[8]).toBeNull(); // correlationId
  });

  test('maxAttempts override is forwarded to INSERT', async () => {
    const tx = makeMockTx();
    await enqueueNotification(tx, { ...BASE_PARAMS, maxAttempts: 10 });
    const [, values] = tx.query.mock.calls[0];
    expect(values[7]).toBe(10);
  });
});

describe('enqueueNotificationBatch — fan-out', () => {
  test('empty array → no INSERT executed', async () => {
    const tx = makeMockTx();
    const result = await enqueueNotificationBatch(tx, []);
    expect(result).toEqual([]);
    expect(tx.query).not.toHaveBeenCalled();
  });

  test('500 rows → single multi-row INSERT (per spec §7 Q3 — one batch for Замоскворечье)', async () => {
    const tx = {
      query: jestApi.fn().mockResolvedValue({
        rows: Array.from({ length: 500 }, (_, i) => ({ id: `row-${i}` })),
      }),
    };
    const rows = Array.from({ length: 500 }, (_, i) => ({
      ...BASE_PARAMS,
      recipientId: `resident-${i}`,
    }));
    const result = await enqueueNotificationBatch(tx, rows);
    expect(result).toHaveLength(500);
    expect(tx.query).toHaveBeenCalledTimes(1);
    const [sql, values] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO\s+notifications_outbox/i);
    // 9 cols per row × 500 rows = 4500 params.
    expect(values).toHaveLength(9 * 500);
    // First row placeholders present.
    expect(sql).toMatch(/\(\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*\$8,\s*\$9\)/);
    // Last row placeholders use offset 4492..4500.
    expect(sql).toMatch(/\$4492/);
    expect(sql).toMatch(/\$4500\)$/m);
  });

  test('validates every row before executing any INSERT (fail-fast)', async () => {
    const tx = makeMockTx();
    const rows = [
      BASE_PARAMS,
      { ...BASE_PARAMS, channel: 'smoke_signal' },
      BASE_PARAMS,
    ];
    await expect(enqueueNotificationBatch(tx, rows)).rejects.toThrow(/invalid channel/);
    expect(tx.query).not.toHaveBeenCalled();
  });

  test('rejects non-array input', async () => {
    const tx = makeMockTx();
    await expect(enqueueNotificationBatch(tx, 'not-array')).rejects.toThrow(
      /paramsList must be array/,
    );
  });
});

describe('isOutboxEnabled — feature flag parsing', () => {
  const ENV_KEY = 'NOTIFICATIONS_OUTBOX_ENABLED';
  let originalValue;

  beforeEach(() => {
    originalValue = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
  });

  test('default (unset) → false (legacy inline path wins)', () => {
    expect(isOutboxEnabled()).toBe(false);
  });

  test('recognises case-insensitive true-ish values', () => {
    for (const v of ['true', 'TRUE', 'True', '1', 'yes', 'on', 'ON']) {
      process.env[ENV_KEY] = v;
      expect(isOutboxEnabled()).toBe(true);
    }
  });

  test('anything else → false (empty, random string, 0, false)', () => {
    for (const v of ['', 'false', '0', 'maybe', 'no']) {
      process.env[ENV_KEY] = v;
      expect(isOutboxEnabled()).toBe(false);
    }
  });
});

describe('computeBackoffMinutes — spec §3', () => {
  test('attemptCount=0 → 0 (first attempt immediate after enqueue)', () => {
    expect(computeBackoffMinutes(0)).toBe(0);
  });

  test('matches documented ladder 1, 5, 15, 60, 240, 1440', () => {
    expect(BACKOFF_MINUTES).toEqual([1, 5, 15, 60, 240, 1440]);
    expect(computeBackoffMinutes(1)).toBe(1);
    expect(computeBackoffMinutes(2)).toBe(5);
    expect(computeBackoffMinutes(3)).toBe(15);
    expect(computeBackoffMinutes(4)).toBe(60);
    expect(computeBackoffMinutes(5)).toBe(240);
    expect(computeBackoffMinutes(6)).toBe(1440);
  });

  test('attemptCount > ladder length → null (worker marks dead)', () => {
    expect(computeBackoffMinutes(7)).toBeNull();
    expect(computeBackoffMinutes(100)).toBeNull();
  });

  test('rejects non-integer / negative', () => {
    expect(() => computeBackoffMinutes(-1)).toThrow();
    expect(() => computeBackoffMinutes(1.5)).toThrow();
    expect(() => computeBackoffMinutes('2')).toThrow();
  });
});

describe('constants — sanity', () => {
  test('DEFAULT_MAX_ATTEMPTS matches BACKOFF_MINUTES length', () => {
    // Инвариант: после N попыток (равных длине ladder'а) строка попадает
    // в dead — иначе будет ladder-overrun.
    expect(DEFAULT_MAX_ATTEMPTS).toBe(BACKOFF_MINUTES.length);
  });
});
