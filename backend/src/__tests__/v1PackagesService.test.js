'use strict';

/**
 * Phase 5 (platform-v1) — packages_v2 service unit tests.
 * Spec: docs/product/specs/platform-v1/packages-v2-spec.md §3 (state machine)
 *       + §5.1 (outbox triggers).
 *
 * Pattern: mock only the `db` / `pool` / `client` interfaces (query + connect
 * + release).  `enqueueNotification` / `enqueueNotificationBatch` — НЕ мокаем:
 * они просто `tx.query(...)` подделанному client'у, так мы проверяем SQL shape
 * end-to-end, включая outbox insert.
 *
 * Phase 6 note: тексты уведомлений переехали в notification_templates_v2,
 * поэтому в happy-path тестах createPackage/pickupPackage/remindPackage
 * добавлен stub-responder на SELECT шаблона (см. templateResponder ниже).
 *
 * Coverage:
 *   • clampLimit                      — default/cap semantics
 *   • listForTenant                   — фильтры, allowlist, сортировка
 *   • listForResident                 — recipient OR unit; 90-day окно; lost скрыт
 *   • getById                         — UUID-валидация, null на miss
 *   • createPackage                   — INSERT + outbox batch в той же транзакции;
 *                                        fan-out по recipient или unit-residents
 *   • updatePackage                   — только whitelist полей; no-op при пустом patch
 *   • pickupPackage                   — FOR UPDATE lock; conflict-статусы;
 *                                        mutual exclusivity resident/name;
 *                                        no confirmation когда picked_up_by_name
 *   • returnPackage / markLostPackage — state-machine transitions; confirm:true
 *   • remindPackage                   — payload shape c days_waiting + manual:true
 *   • getMetrics                      — 4 query structure
 */

const { describe, test, expect, beforeEach, jest: jestGlob } = require('@jest/globals');

// Импорт ПОСЛЕ всех моков (их нет здесь — пишем query-mock'и прямо в tests).
const {
  listForTenant,
  listForResident,
  getById,
  createPackage,
  updatePackage,
  pickupPackage,
  returnPackage,
  markLostPackage,
  remindPackage,
  getMetrics,
  resolveResidentByUid,
  resolveStaffIdByUid,
  resolveUnitIdsForResident,
  ALLOWED_STATUSES,
  ALLOWED_SIZES,
  RECEIVE_CHANNELS,
  REMIND_CHANNELS,
  PICKUP_CONFIRM_CHANNELS,
  clampLimit,
} = require('../v1/services/packages');

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '22222222-2222-3333-4444-555555555555';
const UUID3 = '33333333-2222-3333-4444-555555555555';
const UUID4 = '44444444-2222-3333-4444-555555555555';

// ─── simple query-mock ───────────────────────────────────────────────────────
function makeDb(responders = []) {
  const calls = [];
  async function query(sql, args) {
    calls.push({ sql, args });
    for (const [match, fn] of responders) {
      if (typeof match === 'string' && sql.includes(match)) return fn(sql, args);
      if (match instanceof RegExp && match.test(sql)) return fn(sql, args);
    }
    return { rows: [] };
  }
  return { query, calls };
}

// Pool-like wrapper с pool.connect() → client-like (query + release).
function makePool(responders = []) {
  const calls = [];
  const client = {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [match, fn] of responders) {
        if (typeof match === 'string' && sql.includes(match)) return fn(sql, args);
        if (match instanceof RegExp && match.test(sql)) return fn(sql, args);
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    async connect() { return client; },
    async query(sql, args) { return client.query(sql, args); },
    get calls() { return calls; },
    _client: client,
  };
}

// Phase 6: после миграции текстов уведомлений в notification_templates_v2
// happy-path тесты должны отдавать валидный шаблон на SELECT.  Этот responder
// возвращает общий stub, который подходит для package.received / pickup_*
// без различения ключа — достаточно, чтобы interpolate() вернул непустую body.
const templateResponder = [
  /FROM notification_templates_v2/,
  () => ({
    rows: [{
      template_key: 'stub',
      channel: null,
      locale: 'ru',
      subject: 'Stub subject',
      body: 'Stub body {{days_waiting}}',
      url_template: '/packages/{{package_id}}',
    }],
  }),
];

// ══════════════════════════════════════════════════════════════════════════════
// constants + helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('constants', () => {
  test('ALLOWED_STATUSES covers state machine §3', () => {
    expect(ALLOWED_STATUSES.has('awaiting_pickup')).toBe(true);
    expect(ALLOWED_STATUSES.has('picked_up')).toBe(true);
    expect(ALLOWED_STATUSES.has('returned')).toBe(true);
    expect(ALLOWED_STATUSES.has('lost')).toBe(true);
    expect(ALLOWED_STATUSES.has('bogus')).toBe(false);
  });

  test('ALLOWED_SIZES matches migration CHECK constraint', () => {
    for (const s of ['envelope','small','medium','large','oversize']) {
      expect(ALLOWED_SIZES.has(s)).toBe(true);
    }
    expect(ALLOWED_SIZES.has('huge')).toBe(false);
  });

  test('notification channels cover spec §5.1 fan-out', () => {
    expect(RECEIVE_CHANNELS).toEqual(expect.arrayContaining(['sms', 'web_push']));
    expect(REMIND_CHANNELS).toEqual(expect.arrayContaining(['sms', 'web_push']));
    expect(PICKUP_CONFIRM_CHANNELS).toContain('web_push');
  });
});

describe('clampLimit', () => {
  test('default when no input', () => { expect(clampLimit()).toBe(100); });
  test('default when zero/negative/NaN', () => {
    expect(clampLimit(0)).toBe(100);
    expect(clampLimit(-5)).toBe(100);
    expect(clampLimit('abc')).toBe(100);
  });
  test('floors non-integer', () => { expect(clampLimit(10.7)).toBe(10); });
  test('caps at max', () => { expect(clampLimit(9999)).toBe(500); });
  test('honours custom default and max', () => {
    expect(clampLimit(0, 50, 200)).toBe(50);
    expect(clampLimit(300, 50, 200)).toBe(200);
  });
});

// Phase 6: buildPackageReceivedBody удалён вместе с миграцией в
// notification_templates_v2.  Тесты логики «от X (Y) — хранение: Z»
// теперь покрываются в notificationTemplates.test.js через interpolate()
// + package.received template.

// ══════════════════════════════════════════════════════════════════════════════
// listForTenant — filter assembly
// ══════════════════════════════════════════════════════════════════════════════

describe('listForTenant', () => {
  test('no filters → ORDER BY received_at DESC + LIMIT/OFFSET', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    const res = await listForTenant(db, {});
    expect(res.limit).toBe(100);
    expect(res.offset).toBe(0);
    const sql = db.calls[0].sql;
    expect(sql).toContain('FROM packages_v2');
    expect(sql).toContain('ORDER BY received_at DESC');
    expect(sql).toMatch(/LIMIT \$1 OFFSET \$2/);
  });

  test('rejects invalid status filter', async () => {
    const db = makeDb();
    await expect(listForTenant(db, { status: 'evaporated' })).rejects.toThrow(/invalid status/);
  });

  test('rejects non-UUID unit_id', async () => {
    const db = makeDb();
    await expect(listForTenant(db, { unit_id: 'not-a-uuid' })).rejects.toThrow(/UUID/);
  });

  test('rejects non-UUID recipient_resident_id', async () => {
    const db = makeDb();
    await expect(listForTenant(db, { recipient_resident_id: 'nope' })).rejects.toThrow(/UUID/);
  });

  test('scopes staff list by propertyId when provided', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    await listForTenant(db, { propertyId: UUID4, status: 'awaiting_pickup' });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('property_id = $1');
    expect(sql).toContain('status = $2');
    expect(args.slice(0, 2)).toEqual([UUID4, 'awaiting_pickup']);
  });

  test('rejects invalid ISO for since/until', async () => {
    const db = makeDb();
    await expect(listForTenant(db, { since: 'yesterday' })).rejects.toThrow(/ISO-8601/);
    await expect(listForTenant(db, { until: 'never' })).rejects.toThrow(/ISO-8601/);
  });

  test('assembles WHERE for all filters with correct $-numbering', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    await listForTenant(db, {
      status: 'awaiting_pickup',
      unit_id: UUID,
      recipient_resident_id: UUID2,
      carrier: 'CDEK',
      since: '2026-01-01T00:00:00Z',
      until: '2026-02-01T00:00:00Z',
      limit: 10,
      offset: 5,
    });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('status = $1');
    expect(sql).toContain('unit_id = $2');
    expect(sql).toContain('recipient_resident_id = $3');
    expect(sql).toContain('carrier = $4');
    expect(sql).toContain('received_at >= $5');
    expect(sql).toContain('received_at <= $6');
    expect(sql).toContain('LIMIT $7 OFFSET $8');
    expect(args).toEqual([
      'awaiting_pickup', UUID, UUID2, 'CDEK',
      '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
      10, 5,
    ]);
  });

  test('clamps limit > 500 and offset < 0', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    const r = await listForTenant(db, { limit: 9999, offset: -3 });
    expect(r.limit).toBe(500);
    expect(r.offset).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForResident — recipient OR unit; 90-day window; lost hidden
// ══════════════════════════════════════════════════════════════════════════════

describe('listForResident', () => {
  test('returns empty when residentId missing', async () => {
    const db = makeDb();
    expect(await listForResident(db, null)).toEqual([]);
    expect(db.calls.length).toBe(0);
  });

  test('residentId only — WHERE recipient = $1; no unit filter; lost hidden', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID);
    const { sql, args } = db.calls[0];
    expect(sql).toContain(`recipient_resident_id = $1`);
    // Отсутствие unit_id фильтра — в SQL не упоминается unit_id = ANY
    expect(sql).not.toContain('unit_id = ANY');
    expect(sql).toContain(`status <> 'lost'`);
    expect(sql).toContain("INTERVAL '90 days'");
    expect(args[0]).toBe(UUID);
  });

  test('with unitIds → adds OR recipient IS NULL AND unit = ANY($2)', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID, [UUID2, UUID3], { limit: 7 });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('recipient_resident_id IS NULL AND unit_id = ANY($2::uuid[])');
    expect(args[0]).toBe(UUID);
    expect(args[1]).toEqual([UUID2, UUID3]);
    expect(args[2]).toBe(7);
  });

  test('scopes resident list by propertyId before unit fan-out', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID, [UUID2, UUID3], { propertyId: UUID4, limit: 7 });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('property_id = $2');
    expect(sql).toContain('recipient_resident_id IS NULL AND unit_id = ANY($3::uuid[])');
    expect(args).toEqual([UUID, UUID4, [UUID2, UUID3], 7]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getById — UUID guard + miss
// ══════════════════════════════════════════════════════════════════════════════

describe('getById', () => {
  test('null when id not a UUID (no query issued)', async () => {
    const db = makeDb();
    expect(await getById(db, 'not-a-uuid')).toBeNull();
    expect(db.calls.length).toBe(0);
  });
  test('null when no row', async () => {
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [] })]]);
    expect(await getById(db, UUID)).toBeNull();
  });
  test('returns row when present', async () => {
    const row = { id: UUID, status: 'awaiting_pickup' };
    const db = makeDb([[/FROM packages_v2/, () => ({ rows: [row] })]]);
    expect(await getById(db, UUID)).toEqual(row);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// createPackage — INSERT + outbox in same transaction
// ══════════════════════════════════════════════════════════════════════════════

describe('createPackage', () => {
  const baseInput = {
    propertyId: UUID,
    unitId: UUID2,
    receivedByStaffId: UUID3,
  };

  test('validates propertyId / unitId / receivedByStaffId are UUIDs', async () => {
    await expect(createPackage(makePool(), { ...baseInput, propertyId: 'bad' }))
      .rejects.toThrow(/propertyId/);
    await expect(createPackage(makePool(), { ...baseInput, unitId: 'bad' }))
      .rejects.toThrow(/unitId/);
    await expect(createPackage(makePool(), { ...baseInput, receivedByStaffId: 'bad' }))
      .rejects.toThrow(/receivedByStaffId/);
  });

  test('rejects photo_url that does not start with /uploads/', async () => {
    await expect(createPackage(makePool(), {
      ...baseInput, photoUrl: 'https://evil.tld/pic.png',
    })).rejects.toThrow(/uploads/);
  });

  test('rejects invalid size category', async () => {
    await expect(createPackage(makePool(), {
      ...baseInput, sizeCategory: 'gigantic',
    })).rejects.toThrow(/sizeCategory/);
  });

  test('single recipient: BEGIN → INSERT package → outbox fan-out → COMMIT', async () => {
    const insertedPkg = {
      id: UUID4, property_id: UUID, unit_id: UUID2, sender_name: 'X',
      carrier: 'CDEK', tracking_number: 't', storage_location: 'shelf',
      status: 'awaiting_pickup',
    };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['INSERT INTO packages_v2', () => ({ rows: [insertedPkg] })],
      templateResponder,
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'outbox-1' }, { id: 'outbox-2' }] })],
      ['COMMIT', () => ({})],
    ]);

    const { package: pkg, outboxRows } = await createPackage(pool, {
      ...baseInput,
      recipientResidentId: UUID4,
      senderName: 'X', carrier: 'CDEK', trackingNumber: 't',
    });

    expect(pkg).toEqual(insertedPkg);
    // fan-out: 1 recipient × 2 channels = 2 outbox rows
    expect(outboxRows.length).toBe(2);

    const sqls = pool.calls.map((c) => c.sql);
    expect(sqls[0]).toContain('BEGIN');
    expect(sqls.some((s) => s.includes('INSERT INTO packages_v2'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO notifications_outbox'))).toBe(true);
    expect(sqls[sqls.length - 1]).toContain('COMMIT');
  });

  test('no recipient → fan-out to all active residents of unit (resident_unit_links)', async () => {
    const insertedPkg = {
      id: UUID4, property_id: UUID, unit_id: UUID2, sender_name: null,
      carrier: null, tracking_number: null, storage_location: null,
      status: 'awaiting_pickup',
    };
    // 2 активных резидента на этой квартире → 2×2 каналов = 4 outbox rows.
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['INSERT INTO packages_v2', () => ({ rows: [insertedPkg] })],
      ['FROM resident_unit_links', () => ({ rows: [{ resident_id: 'r1' }, { resident_id: 'r2' }] })],
      templateResponder,
      ['INSERT INTO notifications_outbox', () => ({
        rows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }],
      })],
      ['COMMIT', () => ({})],
    ]);

    const { outboxRows } = await createPackage(pool, baseInput);
    expect(outboxRows.length).toBe(4);
  });

  test('rolls back on INSERT failure', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['INSERT INTO packages_v2', () => { throw new Error('boom'); }],
      ['ROLLBACK', () => ({})],
    ]);
    await expect(createPackage(pool, { ...baseInput, recipientResidentId: UUID4 }))
      .rejects.toThrow('boom');
    const sqls = pool.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('ROLLBACK'))).toBe(true);
    expect(sqls.some((s) => s.includes('COMMIT'))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updatePackage — whitelist only
// ══════════════════════════════════════════════════════════════════════════════

describe('updatePackage', () => {
  test('rejects non-UUID id', async () => {
    await expect(updatePackage(makeDb(), 'bad', { carrier: 'X' }))
      .rejects.toThrow(/UUID/);
  });

  test('empty patch → no UPDATE, returns current row', async () => {
    const row = { id: UUID, status: 'awaiting_pickup' };
    const db = makeDb([[/FROM packages_v2 WHERE id/, () => ({ rows: [row] })]]);
    const out = await updatePackage(db, UUID, {});
    expect(out).toEqual(row);
    expect(db.calls.length).toBe(1);
    expect(db.calls[0].sql).toContain('SELECT');
    expect(db.calls[0].sql).not.toContain('UPDATE');
  });

  test('honours whitelist (carrier, notes, storage_location, photo_url, size_category), ignores others', async () => {
    const row = { id: UUID, status: 'awaiting_pickup' };
    const db = makeDb([[/UPDATE packages_v2/, () => ({ rows: [row] })]]);
    await updatePackage(db, UUID, {
      carrier: 'CDEK', notes: 'N', storage_location: 'A', photo_url: '/uploads/p.png',
      size_category: 'small',
      status: 'lost',              // IGNORED — не в whitelist
      received_at: 'yesterday',    // IGNORED
    });
    const { sql, args } = db.calls[0];
    expect(sql).toContain('carrier = $1');
    expect(sql).toContain('notes = $2');
    expect(sql).toContain('storage_location = $3');
    expect(sql).toContain('photo_url = $4');
    expect(sql).toContain('size_category = $5');
    expect(sql).not.toContain('status = ');
    expect(args).toEqual(['CDEK', 'N', 'A', '/uploads/p.png', 'small', UUID]);
  });

  test('rejects photo_url without /uploads/ prefix', async () => {
    await expect(updatePackage(makeDb(), UUID, { photo_url: 'https://x' }))
      .rejects.toThrow(/uploads/);
  });

  test('rejects invalid size_category', async () => {
    await expect(updatePackage(makeDb(), UUID, { size_category: 'zeppelin' }))
      .rejects.toThrow(/size_category/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// pickupPackage — state transition + outbox
// ══════════════════════════════════════════════════════════════════════════════

describe('pickupPackage', () => {
  test('rejects non-UUID id / staffId', async () => {
    await expect(pickupPackage(makePool(), 'bad', { pickedUpByStaffId: UUID }))
      .rejects.toThrow(/id/);
    await expect(pickupPackage(makePool(), UUID, { pickedUpByStaffId: 'bad' }))
      .rejects.toThrow(/staffId/i);
  });

  test('requires either resident or name', async () => {
    await expect(pickupPackage(makePool(), UUID, { pickedUpByStaffId: UUID2 }))
      .rejects.toThrow(/either/);
  });

  test('rejects both resident AND name (mutual exclusivity)', async () => {
    await expect(pickupPackage(makePool(), UUID, {
      pickedUpByStaffId: UUID2,
      pickedUpByResidentId: UUID3,
      pickedUpByName: 'Courier',
    })).rejects.toThrow(/mutually exclusive/);
  });

  test('not-found → conflict:not_found, no outbox', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await pickupPackage(pool, UUID, {
      pickedUpByStaffId: UUID2,
      pickedUpByResidentId: UUID3,
    });
    expect(r.conflict).toBe('not_found');
    expect(r.package).toBeNull();
    expect(r.outboxRows).toEqual([]);
  });

  test('terminal status → conflict with status string, rolls back', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [{ id: UUID, property_id: UUID4, status: 'picked_up' }] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await pickupPackage(pool, UUID, {
      pickedUpByStaffId: UUID2,
      pickedUpByResidentId: UUID3,
    });
    expect(r.conflict).toBe('picked_up');
  });

  test('happy path with resident → UPDATE + outbox(package.picked_up_confirmation) + COMMIT', async () => {
    const pkg = {
      id: UUID, property_id: UUID4, unit_id: UUID2,
      status: 'picked_up', picked_up_at: '2026-04-20T00:00:00Z',
      picked_up_by_resident_id: UUID3, picked_up_by_name: null,
      picked_up_by_staff_id: UUID2,
    };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [{ id: UUID, property_id: UUID4, status: 'awaiting_pickup' }] })],
      ['UPDATE packages_v2', () => ({ rows: [pkg] })],
      templateResponder,
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'outbox-1' }] })],
      ['COMMIT', () => ({})],
    ]);

    const r = await pickupPackage(pool, UUID, {
      pickedUpByStaffId: UUID2,
      pickedUpByResidentId: UUID3,
    });
    expect(r.package).toEqual(pkg);
    expect(r.outboxRows.length).toBe(1);
    expect(r.conflict).toBeNull();
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('FOR UPDATE');
    expect(sqls).toContain('UPDATE packages_v2');
    expect(sqls).toContain('INSERT INTO notifications_outbox');
    expect(sqls).toContain('COMMIT');
  });

  test('picked_up_by_name (non-resident) → no confirmation outbox', async () => {
    const pkg = {
      id: UUID, property_id: UUID4, status: 'picked_up',
      picked_up_by_resident_id: null, picked_up_by_name: 'Courier',
    };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [{ id: UUID, property_id: UUID4, status: 'awaiting_pickup' }] })],
      ['UPDATE packages_v2', () => ({ rows: [pkg] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await pickupPackage(pool, UUID, {
      pickedUpByStaffId: UUID2,
      pickedUpByName: 'Courier',
    });
    expect(r.outboxRows).toEqual([]);
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).not.toContain('INSERT INTO notifications_outbox');
    expect(sqls).toContain('COMMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// returnPackage / markLostPackage
// ══════════════════════════════════════════════════════════════════════════════

describe('returnPackage', () => {
  test('not_found conflict', async () => {
    // AUDIT #2: returnPackage теперь pool-based (BEGIN + SELECT FOR UPDATE).
    const pool = makePool([['FROM packages_v2 WHERE id', () => ({ rows: [] })]]);
    const r = await returnPackage(pool, UUID, {});
    expect(r.conflict).toBe('not_found');
  });

  test('terminal status → conflict', async () => {
    const pool = makePool([['FROM packages_v2 WHERE id', () => ({ rows: [{ status: 'returned' }] })]]);
    const r = await returnPackage(pool, UUID, { reason: 'x' });
    expect(r.conflict).toBe('returned');
  });

  test('happy path: awaiting → returned, trims reason', async () => {
    const pkg = { id: UUID, status: 'returned', returned_reason: 'no one home' };
    const pool = makePool([
      ['FROM packages_v2 WHERE id', () => ({ rows: [{ status: 'awaiting_pickup' }] })],
      ['UPDATE packages_v2', () => ({ rows: [pkg] })],
    ]);
    const r = await returnPackage(pool, UUID, { reason: '  no one home  ' });
    expect(r.conflict).toBeNull();
    expect(r.package).toEqual(pkg);
    // args second call: [reason, id]
    // NOTE: .includes('UPDATE packages_v2') — 'UPDATE' один также матчит SELECT FOR UPDATE.
    const updateCall = pool.calls.find((c) => c.sql.includes('UPDATE packages_v2'));
    expect(updateCall.args).toEqual(['no one home', UUID]);
    // AUDIT #2: убедимся, что SELECT FOR UPDATE и COMMIT есть в SQL-стриме.
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('FOR UPDATE');
    expect(sqls).toContain('COMMIT');
  });
});

describe('markLostPackage', () => {
  test('requires confirm:true', async () => {
    await expect(markLostPackage(makePool(), UUID, { reason: 'x' })).rejects.toThrow(/confirm/i);
    await expect(markLostPackage(makePool(), UUID, { confirm: false, reason: 'x' })).rejects.toThrow(/confirm/i);
  });
  test('requires reason', async () => {
    await expect(markLostPackage(makePool(), UUID, { confirm: true })).rejects.toThrow(/reason/);
    await expect(markLostPackage(makePool(), UUID, { confirm: true, reason: '   ' })).rejects.toThrow(/reason/);
  });
  test('transitions awaiting → lost', async () => {
    const pkg = { id: UUID, status: 'lost' };
    const pool = makePool([
      ['FROM packages_v2 WHERE id', () => ({ rows: [{ status: 'awaiting_pickup' }] })],
      ['UPDATE packages_v2', () => ({ rows: [pkg] })],
    ]);
    const r = await markLostPackage(pool, UUID, { confirm: true, reason: 'never arrived' });
    expect(r.package).toEqual(pkg);
    expect(r.conflict).toBeNull();
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('FOR UPDATE');
    expect(sqls).toContain('COMMIT');
  });
  test('refuses when already terminal', async () => {
    const pool = makePool([['FROM packages_v2 WHERE id', () => ({ rows: [{ status: 'picked_up' }] })]]);
    const r = await markLostPackage(pool, UUID, { confirm: true, reason: 'x' });
    expect(r.conflict).toBe('picked_up');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// remindPackage — manual reminder
// ══════════════════════════════════════════════════════════════════════════════

describe('remindPackage', () => {
  test('not_found → conflict', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FROM packages_v2 WHERE id', () => ({ rows: [] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await remindPackage(pool, UUID);
    expect(r.conflict).toBe('not_found');
    expect(r.outboxRows).toEqual([]);
  });
  test('non-awaiting → conflict, no outbox', async () => {
    const pkg = { id: UUID, status: 'picked_up', received_at: '2026-01-01', property_id: UUID4, unit_id: UUID2, recipient_resident_id: UUID3 };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FROM packages_v2 WHERE id', () => ({ rows: [pkg] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await remindPackage(pool, UUID);
    expect(r.conflict).toBe('picked_up');
    expect(r.outboxRows).toEqual([]);
  });
  test('happy path: outbox fan-out with days_waiting + manual:true', async () => {
    // received 10 days ago
    const receivedAt = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const pkg = {
      id: UUID, status: 'awaiting_pickup', received_at: receivedAt,
      property_id: UUID4, unit_id: UUID2, recipient_resident_id: UUID3,
    };
    let outboxInsertArgs = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FROM packages_v2 WHERE id', () => ({ rows: [pkg] })],
      templateResponder,
      ['INSERT INTO notifications_outbox', (_sql, args) => {
        outboxInsertArgs = args;
        // 2 каналов на 1 recipient = 2 rows
        return { rows: [{ id: 'o1' }, { id: 'o2' }] };
      }],
      ['COMMIT', () => ({})],
    ]);
    const r = await remindPackage(pool, UUID);
    expect(r.conflict).toBeNull();
    expect(r.outboxRows.length).toBe(2);
    // Payload — каждая 7-я позиция в args (9 колонок на row): смотрим
    // первый row's payload (index 6) — должен содержать manual:true и days_waiting
    const payloadJson = outboxInsertArgs[6];
    const payload = JSON.parse(payloadJson);
    expect(payload.manual).toBe(true);
    expect(payload.days_waiting).toBe(10);
    expect(payload.package_id).toBe(UUID);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getMetrics — 4 queries
// ══════════════════════════════════════════════════════════════════════════════

describe('getMetrics', () => {
  test('rejects non-positive hours', async () => {
    await expect(getMetrics(makeDb(), 0)).rejects.toThrow(TypeError);
    await expect(getMetrics(makeDb(), -1)).rejects.toThrow(TypeError);
    await expect(getMetrics(makeDb(), 'abc')).rejects.toThrow(TypeError);
  });

  test('emits open-count + avg + returned-rate + top_carriers', async () => {
    const db = makeDb([
      [/status = 'awaiting_pickup'/, () => ({ rows: [{ open_count: 3 }] })],
      [/AVG\(EXTRACT/, () => ({ rows: [{ avg_hours: 26.5 }] })],
      [/FILTER \(WHERE status = 'returned'\)/, () => ({ rows: [{ returned: 2, closed: 10 }] })],
      [/GROUP BY carrier/, () => ({ rows: [
        { carrier: 'CDEK', total: 5 }, { carrier: 'WB', total: 4 },
      ] })],
    ]);
    const m = await getMetrics(db, 24 * 7);
    expect(m.open_count).toBe(3);
    expect(m.avg_pickup_hours).toBeCloseTo(26.5, 3);
    expect(m.returned_rate).toBeCloseTo(0.2, 3);
    expect(m.top_carriers).toEqual([
      { carrier: 'CDEK', total: 5 }, { carrier: 'WB', total: 4 },
    ]);
    expect(m.period_hours).toBe(168);
    expect(typeof m.generated_at).toBe('string');
  });

  test('scopes all metrics queries by propertyId', async () => {
    const db = makeDb([
      [/status = 'awaiting_pickup'/, () => ({ rows: [{ open_count: 1 }] })],
      [/AVG\(EXTRACT/, () => ({ rows: [{ avg_hours: null }] })],
      [/FILTER \(WHERE status = 'returned'\)/, () => ({ rows: [{ returned: 0, closed: 0 }] })],
      [/GROUP BY carrier/, () => ({ rows: [] })],
    ]);
    await getMetrics(db, 24, { propertyId: UUID4 });
    for (const { sql, args } of db.calls) {
      expect(sql).toContain('property_id = $1');
      expect(args[0]).toBe(UUID4);
    }
  });

  test('returned_rate null when no closed packages', async () => {
    const db = makeDb([
      [/status = 'awaiting_pickup'/, () => ({ rows: [{ open_count: 0 }] })],
      [/AVG\(EXTRACT/, () => ({ rows: [{ avg_hours: null }] })],
      [/FILTER \(WHERE status = 'returned'\)/, () => ({ rows: [{ returned: 0, closed: 0 }] })],
      [/GROUP BY carrier/, () => ({ rows: [] })],
    ]);
    const m = await getMetrics(db, 24);
    expect(m.returned_rate).toBeNull();
    expect(m.avg_pickup_hours).toBeNull();
    expect(m.top_carriers).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolve helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('resolve helpers', () => {
  test('resolveResidentByUid returns null on empty uid and uses external_uid column', async () => {
    expect(await resolveResidentByUid(makeDb(), null)).toBeNull();
    const db = makeDb([[/FROM residents WHERE external_uid/, () => ({ rows: [{ id: UUID }] })]]);
    expect(await resolveResidentByUid(db, 'u-1')).toBe(UUID);
  });

  test('resolveStaffIdByUid uses staff_users.external_uid', async () => {
    const db = makeDb([[/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID }] })]]);
    expect(await resolveStaffIdByUid(db, 'u-1')).toBe(UUID);
  });

  test('resolveUnitIdsForResident reads active links', async () => {
    const db = makeDb([[/FROM resident_unit_links/, () => ({
      rows: [{ unit_id: 'u1' }, { unit_id: 'u2' }],
    })]]);
    expect(await resolveUnitIdsForResident(db, UUID)).toEqual(['u1', 'u2']);
  });
});
