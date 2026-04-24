'use strict';

// platform-v1 integration e2e — packages_v2 receive → pickup flow.
// Spec: packages-v2-spec.md §7 AC:
//   «Интеграционный тест e2e: приём → notification в outbox → pickup →
//    confirmation в outbox — обе в notification_log_v2»
//
// Что проверяем end-to-end:
//   1. createPackage() с recipient_resident_id → outbox(package.received)
//      на N residents × M channels; RECEIVE_CHANNELS = ['sms','web_push'].
//   2. Первый processBatch — delivers «package.received» rows, log_v2 += M.
//   3. pickupPackage() с picked_up_by_resident_id → outbox(package.picked_up_confirmation)
//      на одного резидента × 1 channel; PICKUP_CONFIRM_CHANNELS = ['web_push'].
//   4. Второй processBatch — delivers confirmation, log_v2 += 1.
//   5. Итог: log_v2 по correlation_id этого package содержит обе цепочки.
//
// Prerequisite — тот же, что для announcements.e2e.integration.test.js:
//   TEST_DATABASE_URL + pgcrypto.  См. backend/README.md §«platform-v1
//   integration tests».  Без env — describe.skip.
//
// Isolation: per-test seed/cleanup по property_id; test не транзакционен
// целиком, потому что createPackage/pickupPackage сами открывают
// транзакцию (SELECT FOR UPDATE на pickup).
//
// Channels.dispatch замокан через jest.mock → processBatch() deterministic.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

jest.mock('../channels', () => ({
  dispatch: jest.fn().mockResolvedValue({
    ok: true,
    providerMessageId: 'mock-msg-id',
  }),
}));

const { Pool } = require('pg');
const {
  createPackage, pickupPackage,
  RECEIVE_CHANNELS, PICKUP_CONFIRM_CHANNELS,
} = require('../packages');
const outboxWorker = require('../../workers/outboxWorker');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('./_fixtures');

describeIfPg('platform-v1 integration e2e: packages receive → pickup', () => {
  /** @type {Pool} */
  let pool;
  let dbReady = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query('SELECT 1');
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await applyV1Migrations(pool);
      dbReady = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[packages.e2e] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('receive + pickup → два события в log_v2 per correlation_id', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;
    const residentId = residentIds[0];

    try {
      // 1. createPackage — recipient_resident_id задан → outbox только ему,
      //    по RECEIVE_CHANNELS (sms + web_push).
      const receive = await createPackage(pool, {
        propertyId,
        unitId,
        recipientResidentId: residentId,
        recipientNameSnapshot: 'E2E Resident',
        senderName: 'Yandex Market',
        carrier: 'yandex',
        trackingNumber: 'E2E-12345',
        sizeCategory: 'm',
        receivedByStaffId: staffId,
        storageLocation: 'A12',
      });
      expect(receive.package.id).toMatch(/^[0-9a-f]{8}-/i);
      expect(receive.package.status).toBe('awaiting_pickup');
      expect(receive.outboxRows).toHaveLength(RECEIVE_CHANNELS.length); // 1 × 2

      const packageId = receive.package.id;

      // 2. Outbox state после приёма: 2 pending rows, event='package.received'.
      const { rows: outboxReceive } = await pool.query(
        `SELECT status, channel, event_type, recipient_id
           FROM notifications_outbox
          WHERE correlation_id = $1
          ORDER BY channel`,
        [packageId],
      );
      expect(outboxReceive).toHaveLength(RECEIVE_CHANNELS.length);
      for (const r of outboxReceive) {
        expect(r.status).toBe('pending');
        expect(r.event_type).toBe('package.received');
        expect(r.recipient_id).toBe(residentId);
        expect(RECEIVE_CHANNELS).toContain(r.channel);
      }

      // 3. Worker processes первую партию — ['package.received'] × 2 ch.
      let stats = await outboxWorker.processBatch(pool);
      expect(stats.sent).toBe(RECEIVE_CHANNELS.length);
      expect(stats.failed).toBe(0);

      // 4. pickupPackage — резидент забирает сам → confirmation в outbox.
      const pickup = await pickupPackage(pool, packageId, {
        pickedUpByResidentId: residentId,
        pickedUpByStaffId: staffId,
      });
      expect(pickup.conflict).toBeNull();
      expect(pickup.package.status).toBe('picked_up');
      expect(pickup.outboxRows).toHaveLength(PICKUP_CONFIRM_CHANNELS.length); // 1

      // 5. Outbox state: 3 rows по correlation_id — 2 sent (receive) + 1
      //    pending (pickup_confirmation).
      const { rows: outboxMid } = await pool.query(
        `SELECT status, event_type
           FROM notifications_outbox
          WHERE correlation_id = $1
          ORDER BY event_type, status`,
        [packageId],
      );
      expect(outboxMid).toHaveLength(RECEIVE_CHANNELS.length + PICKUP_CONFIRM_CHANNELS.length);
      const sentReceive = outboxMid.filter(
        (r) => r.event_type === 'package.received' && r.status === 'sent',
      );
      expect(sentReceive).toHaveLength(RECEIVE_CHANNELS.length);
      const pendingPickup = outboxMid.filter(
        (r) => r.event_type === 'package.picked_up_confirmation' && r.status === 'pending',
      );
      expect(pendingPickup).toHaveLength(PICKUP_CONFIRM_CHANNELS.length);

      // 6. Второй processBatch — delivers confirmation.
      stats = await outboxWorker.processBatch(pool);
      expect(stats.sent).toBe(PICKUP_CONFIRM_CHANNELS.length);

      // 7. Все outbox → sent; log_v2 содержит обе цепочки.
      const { rows: outboxFinal } = await pool.query(
        `SELECT status FROM notifications_outbox WHERE correlation_id = $1`,
        [packageId],
      );
      for (const r of outboxFinal) expect(r.status).toBe('sent');

      const { rows: logByEvent } = await pool.query(
        `SELECT event_type, COUNT(*)::int AS n
           FROM notification_log_v2
          WHERE outbox_id IN (
            SELECT id FROM notifications_outbox WHERE correlation_id = $1
          )
          GROUP BY event_type
          ORDER BY event_type`,
        [packageId],
      );
      expect(logByEvent).toEqual([
        { event_type: 'package.picked_up_confirmation', n: PICKUP_CONFIRM_CHANNELS.length },
        { event_type: 'package.received', n: RECEIVE_CHANNELS.length },
      ]);

      // 8. Суммарно — log_v2 содержит ровно (receive channels + pickup channels)
      //    строк со status='sent' для этого package.
      const { rows: totalLog } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notification_log_v2
          WHERE status = 'sent'
            AND outbox_id IN (
              SELECT id FROM notifications_outbox WHERE correlation_id = $1
            )`,
        [packageId],
      );
      expect(totalLog[0].n).toBe(RECEIVE_CHANNELS.length + PICKUP_CONFIRM_CHANNELS.length);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('pickup by non-resident (picked_up_by_name) → confirmation outbox пустой', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;
    const residentId = residentIds[0];

    try {
      // Приём (как выше).
      const receive = await createPackage(pool, {
        propertyId,
        unitId,
        recipientResidentId: residentId,
        receivedByStaffId: staffId,
      });
      await outboxWorker.processBatch(pool); // деливерим прием

      // Pickup по имени — родственник / курьер.  Spec §3:
      // «Для pickedUpByName (не-резидент) — подтверждения нет».
      const pickup = await pickupPackage(pool, receive.package.id, {
        pickedUpByName: 'Сын резидента',
        pickedUpByStaffId: staffId,
      });
      expect(pickup.conflict).toBeNull();
      expect(pickup.package.status).toBe('picked_up');
      expect(pickup.outboxRows).toHaveLength(0);

      // Никакой новой pickup_confirmation row не появилось.
      const { rows: pickupRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = 'package.picked_up_confirmation'`,
        [receive.package.id],
      );
      expect(pickupRows[0].n).toBe(0);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});

// Helpers — applyV1Migrations / seedFixture / cleanupFixture — вынесены
// в ./_fixtures.js, там же seed для building/entrance/unit/staff/residents
// + unified cleanup для packages_v2 + announcements_v2 + notification_*.
