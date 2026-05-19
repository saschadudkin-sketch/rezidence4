'use strict';

/**
 * Phase 5 — v1 outboxWorker unit tests.
 * Spec: docs/product/specs/platform-v1/notifications-outbox-spec.md §4.4, §7.Q4.
 *
 * Layers tested:
 *   • truncate / deriveErrorCode helpers
 *   • processRow — success, retryable failure, dead (adapter / reached-max /
 *     overrun-backoff), adapter throw, log_v2 normalisation (external,
 *     vehicle, internal-no-id).
 *   • lockBatch — SQL shape: UPDATE..WHERE status IN ('pending','failed'),
 *     RETURNING, LIMIT, ORDER BY next_attempt_at.
 *   • processBatch — BEGIN/COMMIT per row; ROLLBACK + revival UPDATE on throw;
 *     bail if db.connect() fails.
 *   • runOnce — advisory-lock acquire/release, lock held on same client,
 *     release guaranteed even if processBatch throws.
 */

const {
  describe, test, expect, beforeEach, jest: jestApi,
} = require('@jest/globals');

// ─── Mock channels dispatcher so we can control adapter outcomes ─────────────
jest.mock('../v1/services/channels', () => ({
  dispatch: jest.fn(),
}));

const channels = require('../v1/services/channels');
const worker   = require('../v1/workers/outboxWorker');
const { BACKOFF_MINUTES } = require('../v1/services/notificationOutbox');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTx() {
  return { query: jestApi.fn().mockResolvedValue({ rows: [] }) };
}

function makeRow(overrides = {}) {
  return {
    id:                'ob-1',
    property_id:       'p1',
    event_type:        'request.approved',
    channel:           'web_push',
    recipient_type:    'resident',
    recipient_id:      'u1',
    recipient_address: JSON.stringify({ endpoint: 'e' }),
    payload:           { title: 't', body: 'b' },
    attempt_count:     0,
    max_attempts:      6,
    correlation_id:    null,
    ...overrides,
  };
}

// pick out the Nth query call whose SQL matches a regex — tests become
// robust to unrelated queries (BEGIN/COMMIT) being interleaved.
function findQuery(mockFn, regex) {
  return mockFn.mock.calls.find(([sql]) => regex.test(sql));
}

// ══════════════════════════════════════════════════════════════════════════════
// helpers — truncate / deriveErrorCode
// ══════════════════════════════════════════════════════════════════════════════

describe('truncate', () => {
  test('passes short strings through', () => {
    expect(worker.truncate('hello', 10)).toBe('hello');
  });

  test('cuts long strings with ellipsis at boundary', () => {
    const s = 'x'.repeat(600);
    const out = worker.truncate(s, 500);
    expect(out).toHaveLength(500);
    expect(out.endsWith('...')).toBe(true);
  });

  test('null → null', () => {
    expect(worker.truncate(null)).toBeNull();
  });

  test('coerces non-string to string', () => {
    expect(worker.truncate(42, 10)).toBe('42');
  });
});

describe('deriveErrorCode', () => {
  test('falls back to unknown_error for null / empty', () => {
    expect(worker.deriveErrorCode(null)).toBe('unknown_error');
    expect(worker.deriveErrorCode({})).toBe('unknown_error');
  });

  test('uses explicit errorCode if provided', () => {
    expect(worker.deriveErrorCode({ errorCode: 'invalid_phone_number' }))
      .toBe('invalid_phone_number');
  });

  test('truncates long errorCode to 40 chars', () => {
    const long = 'x'.repeat(80);
    expect(worker.deriveErrorCode({ errorCode: long })).toHaveLength(40);
  });

  test('extracts token before first colon from error message', () => {
    expect(worker.deriveErrorCode({ error: 'telegram_api_error: 429 Too Many' }))
      .toBe('telegram_api_error');
  });

  test('sanitises non-identifier characters', () => {
    expect(worker.deriveErrorCode({ error: 'bad error! with spaces' }))
      .toBe('bad_error__with_spaces');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processRow — success path
// ══════════════════════════════════════════════════════════════════════════════

describe('processRow — success path', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('adapter ok → UPDATE status=sent + INSERT log_v2 sent + returns "sent"', async () => {
    channels.dispatch.mockResolvedValue({ ok: true, providerMessageId: 'prov-1' });
    const tx = makeTx();
    const row = makeRow();

    const outcome = await worker.processRow(tx, row, null);

    expect(outcome).toBe('sent');
    expect(channels.dispatch).toHaveBeenCalledWith('web_push', expect.objectContaining({
      recipientAddress: row.recipient_address,
      payload:          row.payload,
      eventType:        'request.approved',
      row,
    }));

    const updateSent = findQuery(tx.query, /UPDATE notifications_outbox.*status='sent'/s);
    expect(updateSent).toBeDefined();
    expect(updateSent[0]).toMatch(/WHERE id=\$1\s+AND property_id=\$3/);
    expect(updateSent[1]).toEqual([row.id, 1, row.property_id]); // attempt_count=1

    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    expect(logInsert).toBeDefined();
    // status=sent (param 8), error_code/error_message null (params 10,11),
    // providerMessageId 'prov-1' (param 12), attempt_count=1 (param 13).
    const params = logInsert[1];
    expect(params[7]).toBe('sent');
    expect(params[9]).toBeNull();
    expect(params[10]).toBeNull();
    expect(params[11]).toBe('prov-1');
    expect(params[12]).toBe(1);
  });

  test('payload is JSON-stringified into log_v2 when object', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({ payload: { title: 't', body: 'b' } });
    await worker.processRow(tx, row, null);
    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    const payloadParam = logInsert[1][8];
    expect(typeof payloadParam).toBe('string');
    expect(JSON.parse(payloadParam)).toEqual({ title: 't', body: 'b' });
  });

  test('passes correlation_id through to channel adapter', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({ channel: 'webhook', correlation_id: 'corr-uuid-1' });

    await worker.processRow(tx, row, null);

    expect(channels.dispatch).toHaveBeenCalledWith('webhook', expect.objectContaining({
      correlationId: 'corr-uuid-1',
      row,
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processRow — retryable failure
// ══════════════════════════════════════════════════════════════════════════════

describe('processRow — retryable failure', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('adapter {ok:false, dead:false}, attempts<max → UPDATE status=failed + backoff, NO log_v2', async () => {
    channels.dispatch.mockResolvedValue({
      ok: false, error: 'network_timeout', dead: false,
    });
    const tx = makeTx();
    const row = makeRow({ attempt_count: 1, max_attempts: 6 });

    const outcome = await worker.processRow(tx, row, null);

    expect(outcome).toBe('failed');
    const update = findQuery(tx.query, /UPDATE notifications_outbox.*status='failed'/s);
    expect(update).toBeDefined();
    // params: [id, backoffMinutes, newAttemptCount, errorMessage]
    // attempt_count goes 1 → 2, so computeBackoffMinutes(2) = BACKOFF_MINUTES[1] = 5
    expect(update[1][0]).toBe(row.id);
    expect(update[1][1]).toBe(BACKOFF_MINUTES[1]); // 5
    expect(update[1][2]).toBe(2);
    expect(update[1][3]).toBe('network_timeout');
    expect(update[1][4]).toBe(row.property_id);
    expect(update[0]).toMatch(/AND property_id=\$5/);

    expect(findQuery(tx.query, /INSERT INTO notification_log_v2/)).toBeUndefined();
  });

  test('adapter throws → treated as retryable failure (not dead)', async () => {
    channels.dispatch.mockRejectedValue(new Error('kaboom'));
    const tx = makeTx();
    const row = makeRow({ attempt_count: 0, max_attempts: 6 });

    const outcome = await worker.processRow(tx, row, null);

    expect(outcome).toBe('failed');
    const update = findQuery(tx.query, /UPDATE notifications_outbox.*status='failed'/s);
    expect(update).toBeDefined();
    expect(update[1][3]).toBe('kaboom');
    expect(update[1][4]).toBe(row.property_id);
    expect(findQuery(tx.query, /INSERT INTO notification_log_v2/)).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processRow — dead transitions
// ══════════════════════════════════════════════════════════════════════════════

describe('processRow — dead path', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('adapter {dead:true} → UPDATE dead + INSERT log_v2 failed + returns "dead"', async () => {
    channels.dispatch.mockResolvedValue({
      ok: false, dead: true, error: 'invalid_phone_number',
    });
    const tx = makeTx();
    const row = makeRow({ attempt_count: 0 });

    const outcome = await worker.processRow(tx, row, null);

    expect(outcome).toBe('dead');
    const update = findQuery(tx.query, /UPDATE notifications_outbox.*status='dead'/s);
    expect(update).toBeDefined();
    expect(update[0]).toMatch(/AND property_id=\$4/);
    expect(update[1][3]).toBe(row.property_id);

    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    expect(logInsert).toBeDefined();
    const params = logInsert[1];
    expect(params[7]).toBe('failed');            // log_v2 has no 'dead'
    expect(params[9]).toBe('invalid_phone_number'); // error_code
    expect(params[10]).toBe('invalid_phone_number'); // error_message
  });

  test('attempts+1 >= max_attempts → dead regardless of retryable flag', async () => {
    channels.dispatch.mockResolvedValue({
      ok: false, dead: false, error: 'still_failing',
    });
    const tx = makeTx();
    const row = makeRow({ attempt_count: 5, max_attempts: 6 }); // next = 6 = max

    const outcome = await worker.processRow(tx, row, null);
    expect(outcome).toBe('dead');
    expect(findQuery(tx.query, /UPDATE notifications_outbox.*status='dead'/s)).toBeDefined();
    expect(findQuery(tx.query, /INSERT INTO notification_log_v2/)).toBeDefined();
  });

  test('computeBackoff overrun (attempt_count reaches ladder end) → dead', async () => {
    // BACKOFF_MINUTES has 6 entries; attemptCount=7 overruns.
    channels.dispatch.mockResolvedValue({
      ok: false, dead: false, error: 'perma_fail',
    });
    const tx = makeTx();
    // Set max_attempts very high so we don't hit reached-max first:
    const row = makeRow({
      attempt_count: BACKOFF_MINUTES.length, // → newAttemptCount = len+1 → overrun
      max_attempts:  999,
    });

    const outcome = await worker.processRow(tx, row, null);
    expect(outcome).toBe('dead');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// log_v2 recipient_type normalisation
// ══════════════════════════════════════════════════════════════════════════════

describe('log_v2 recipient_type normalisation', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  test('external → recipient_id forced to NULL in log_v2', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({
      recipient_type:    'external',
      recipient_id:      'wh-uuid',          // webhook id — must be NULL in log_v2
      recipient_address: 'https://hook/',
    });
    await worker.processRow(tx, row, null);

    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    expect(logInsert).toBeDefined();
    // VALUES order: property_id, outbox_id, recipient_type, recipient_id, recipient_address, ...
    const params = logInsert[1];
    expect(params[2]).toBe('external');
    expect(params[3]).toBeNull();
    expect(params[4]).toBe('https://hook/');
  });

  test('vehicle → coerced to external + recipient_id NULL', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({
      recipient_type:    'vehicle',
      recipient_id:      'car-uuid',
      recipient_address: 'plate-A123',
    });
    await worker.processRow(tx, row, null);
    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    const params = logInsert[1];
    expect(params[2]).toBe('external');
    expect(params[3]).toBeNull();
  });

  test('internal without recipient_id → defensive coerce to external', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({
      recipient_type: 'resident',
      recipient_id:   null, // would fail internal_has_id CHECK
    });
    await worker.processRow(tx, row, null);
    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    const params = logInsert[1];
    expect(params[2]).toBe('external');
    expect(params[3]).toBeNull();
  });

  test('internal with recipient_id → pass through unchanged', async () => {
    channels.dispatch.mockResolvedValue({ ok: true });
    const tx = makeTx();
    const row = makeRow({ recipient_type: 'staff', recipient_id: 'staff-1' });
    await worker.processRow(tx, row, null);
    const logInsert = findQuery(tx.query, /INSERT INTO notification_log_v2/);
    const params = logInsert[1];
    expect(params[2]).toBe('staff');
    expect(params[3]).toBe('staff-1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// lockBatch — SQL shape
// ══════════════════════════════════════════════════════════════════════════════

describe('lockBatch', () => {
  test('atomic CTE UPDATE...RETURNING with correct WHERE/ORDER/LIMIT/locking', async () => {
    const db = {
      query: jestApi.fn().mockResolvedValue({
        rows: [{ id: 'ob-1' }, { id: 'ob-2' }],
      }),
    };
    const rows = await worker.lockBatch(db, 25);

    expect(rows).toEqual([{ id: 'ob-1' }, { id: 'ob-2' }]);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];

    // Atomic: one statement that selects and changes status defensively.
    expect(sql).toMatch(/^\s*WITH candidates AS/);
    expect(sql).toMatch(/UPDATE notifications_outbox/);
    expect(sql).toMatch(/SET status='in_flight'/);
    // Eligibility window:
    expect(sql).toMatch(/status IN \('pending','failed'\)/);
    expect(sql).toMatch(/next_attempt_at\s*<=\s*NOW\(\)/);
    // FIFO-ish order:
    expect(sql).toMatch(/ORDER BY next_attempt_at/);
    // Batch cap:
    expect(sql).toMatch(/LIMIT \$1/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/notifications_outbox\.status IN \('pending','failed'\)/);
    expect(sql).toMatch(/RETURNING/);
    expect(params).toEqual([25]);
  });

  test('default batchSize is worker.DEFAULT_BATCH_SIZE', async () => {
    const db = { query: jestApi.fn().mockResolvedValue({ rows: [] }) };
    await worker.lockBatch(db);
    expect(db.query.mock.calls[0][1]).toEqual([worker.DEFAULT_BATCH_SIZE]);
  });

  test('propertyId scopes candidate selection and defensive update condition', async () => {
    const db = { query: jestApi.fn().mockResolvedValue({ rows: [] }) };
    await worker.lockBatch(db, 10, 'property-a');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/AND property_id::text = \$2/);
    expect(sql).toMatch(/AND notifications_outbox\.property_id::text = \$2/);
    expect(params).toEqual([10, 'property-a']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processBatch
// ══════════════════════════════════════════════════════════════════════════════

describe('processBatch', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  function makePoolWithClient({
    lockedRows, clientQuery, connectFails = false,
  }) {
    const released = { count: 0 };
    const beginCommitLog = [];
    const client = {
      query: jestApi.fn(async (sql, params) => {
        beginCommitLog.push(sql);
        if (clientQuery) return clientQuery(sql, params);
        return { rows: [] };
      }),
      release: jestApi.fn(() => { released.count += 1; }),
    };
    const db = {
      query: jestApi.fn(async (sql) => {
        // The lockBatch SQL is a CTE UPDATE ... RETURNING on the pool.
        if (/UPDATE notifications_outbox/.test(sql)) {
          return { rows: lockedRows };
        }
        // Revival UPDATE (processBatch fallback) is also via pool.
        return { rows: [] };
      }),
      connect: jestApi.fn(async () => {
        if (connectFails) throw new Error('pool_exhausted');
        return client;
      }),
    };
    return { db, client, released, beginCommitLog };
  }

  test('success path — BEGIN → processRow → COMMIT, release client', async () => {
    const row = makeRow();
    channels.dispatch.mockResolvedValue({ ok: true });
    const { db, client, released } = makePoolWithClient({ lockedRows: [row] });

    const stats = await worker.processBatch(db, { batchSize: 10 });

    expect(stats.processed).toBe(1);
    expect(stats.sent).toBe(1);
    expect(released.count).toBe(1);

    // client received BEGIN, UPDATE, INSERT, COMMIT in that order.
    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  test('per-row throw → ROLLBACK + revival UPDATE via pool, count in errors', async () => {
    const row = makeRow();
    // Adapter succeeds → processRow tries to INSERT log_v2 → client throws mid-tx.
    channels.dispatch.mockResolvedValue({ ok: true });
    const { db, client, released } = makePoolWithClient({
      lockedRows: [row],
      clientQuery: (sql) => {
        if (sql === 'BEGIN') return { rows: [] };
        if (/INSERT INTO notification_log_v2/.test(sql)) {
          throw new Error('disk_full');
        }
        return { rows: [] };
      },
    });

    const stats = await worker.processBatch(db, { batchSize: 10 });

    expect(stats.errors).toBe(1);
    expect(stats.sent).toBeFalsy();

    const sqls = client.query.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain('ROLLBACK');

    // Revival UPDATE occurred via pool (not via client — client is in aborted tx).
    const revival = db.query.mock.calls.find(
      ([sql]) => /SET status='failed'/.test(sql) && /INTERVAL '5 minutes'/.test(sql),
    );
    expect(revival).toBeDefined();
    expect(revival[1][0]).toBe(row.id);
    expect(revival[1][2]).toBe(row.property_id);
    expect(revival[0]).toMatch(/AND property_id=\$3/);
    expect(released.count).toBe(1);
  });

  test('db.connect() fails → bail without throwing, report in errors', async () => {
    const { db } = makePoolWithClient({
      lockedRows: [makeRow(), makeRow({ id: 'ob-2' })],
      connectFails: true,
    });
    const stats = await worker.processBatch(db, { batchSize: 10 });
    expect(stats.processed).toBe(2);
    expect(stats.errors).toBe(1); // bail after first failure
  });

  test('empty batch → no iteration, zero counts', async () => {
    const { db } = makePoolWithClient({ lockedRows: [] });
    const stats = await worker.processBatch(db, { batchSize: 10 });
    expect(stats).toEqual({ processed: 0, sent: 0, failed: 0, dead: 0, errors: 0 });
    expect(db.connect).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// runOnce — advisory-lock lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe('runOnce', () => {
  beforeEach(() => { jestApi.clearAllMocks(); });

  function makeDbForRunOnce({ lockAcquired = true, lockThrows = false, processThrows = false } = {}) {
    const client = {
      query: jestApi.fn(async (sql) => {
        if (/pg_try_advisory_lock/.test(sql)) {
          if (lockThrows) throw new Error('lock_error');
          return { rows: [{ locked: lockAcquired }] };
        }
        if (/pg_advisory_unlock/.test(sql)) {
          return { rows: [{ unlocked: true }] };
        }
        return { rows: [] };
      }),
      release: jestApi.fn(),
    };
    // separate pool clients used by processBatch (different sessions)
    const batchClient = {
      query: jestApi.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (processThrows && /UPDATE notifications_outbox/.test(sql) && /sent/.test(sql)) {
          throw new Error('bang');
        }
        return { rows: [] };
      }),
      release: jestApi.fn(),
    };
    let firstConnect = true;
    const db = {
      query: jestApi.fn(async (sql) => {
        // lockBatch SQL (via pool.query) — return no rows → processBatch early-outs.
        if (/UPDATE notifications_outbox/.test(sql)) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      connect: jestApi.fn(async () => {
        if (firstConnect) {
          firstConnect = false;
          return client;
        }
        return batchClient;
      }),
    };
    return { db, client, batchClient };
  }

  test('requires propertyId', async () => {
    await expect(worker.runOnce({}, {})).rejects.toThrow(/propertyId required/);
  });

  test('lock NOT acquired → returns {acquired:false, processed:0}, releases client', async () => {
    const { db, client } = makeDbForRunOnce({ lockAcquired: false });
    const r = await worker.runOnce(db, { propertyId: 'p1' });
    expect(r).toEqual({ acquired: false, processed: 0 });
    // unlock NOT issued when lock was not acquired
    const unlockCall = client.query.mock.calls.find(
      ([sql]) => /pg_advisory_unlock/.test(sql),
    );
    expect(unlockCall).toBeUndefined();
    expect(client.release).toHaveBeenCalled();
  });

  test('lock acquired → processBatch runs, unlock issued, client released', async () => {
    const { db, client } = makeDbForRunOnce({ lockAcquired: true });
    const r = await worker.runOnce(db, { propertyId: 'p1' });
    expect(r.acquired).toBe(true);
    expect(r.processed).toBe(0);

    const lockCall = client.query.mock.calls.find(
      ([sql]) => /pg_try_advisory_lock/.test(sql),
    );
    expect(lockCall).toBeDefined();
    expect(lockCall[1]).toEqual(['outbox-p1']);

    const unlockCall = client.query.mock.calls.find(
      ([sql]) => /pg_advisory_unlock/.test(sql),
    );
    expect(unlockCall).toBeDefined();
    expect(unlockCall[1]).toEqual(['outbox-p1']);

    expect(client.release).toHaveBeenCalled();
    const lockBatchCall = db.query.mock.calls.find(([sql]) => /SET status='in_flight'/.test(sql));
    expect(lockBatchCall[1]).toEqual([worker.DEFAULT_BATCH_SIZE, 'p1']);
  });

  test('processBatch throws → unlock + release still happen (try/finally)', async () => {
    // Trigger a throw from INSIDE processBatch by making the lockBatch UPDATE
    // blow up.  We can't spyOn(worker, 'processBatch') because runOnce calls
    // the LOCAL `processBatch` reference, not the module export.  Making the
    // SQL-path throw is how the error would actually surface in production.
    const lockClient = {
      query: jestApi.fn(async (sql) => {
        if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
        if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
        return { rows: [] };
      }),
      release: jestApi.fn(),
    };
    const db = {
      query: jestApi.fn(async (sql) => {
        if (/UPDATE notifications_outbox/.test(sql)
            && /SET status='in_flight'/.test(sql)) {
          throw new Error('batch_died');
        }
        return { rows: [] };
      }),
      connect: jestApi.fn(async () => lockClient),
    };

    await expect(worker.runOnce(db, { propertyId: 'p1' }))
      .rejects.toThrow('batch_died');

    const unlockCall = lockClient.query.mock.calls.find(
      ([sql]) => /pg_advisory_unlock/.test(sql),
    );
    expect(unlockCall).toBeDefined();
    expect(lockClient.release).toHaveBeenCalled();
  });

  test('advisory-lock key is hashtext of `outbox-<propertyId>`', async () => {
    const { db, client } = makeDbForRunOnce({ lockAcquired: true });
    await worker.runOnce(db, { propertyId: 'zamoskv-42' });
    const call = client.query.mock.calls.find(([sql]) => /pg_try_advisory_lock/.test(sql));
    expect(call[0]).toMatch(/pg_try_advisory_lock\(hashtext\(\$1\)\)/);
    expect(call[1]).toEqual(['outbox-zamoskv-42']);
  });
});
