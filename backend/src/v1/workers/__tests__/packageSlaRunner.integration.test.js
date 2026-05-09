'use strict';

// platform-v1 integration e2e — packageSlaRunner SLA tick.
// Spec: packages-v2-spec.md §5 (SLA reminders + manual follow-up/alerts) +
// workers/packageSlaRunner.js header comment.
//
// Что проверяем end-to-end (real PostgreSQL, real packagesService.remindPackage,
// real outbox escalation writes):
//
//   1. Свежая посылка (received_at = NOW()) — tickSingleTenant ничего не
//      делает.
//   2. Backdated 8 days (между REMIND_AFTER_DAYS=7 и FOLLOWUP_DAYS=14):
//      tick шлёт reminder — outbox получает N residents × M channels rows
//      с event_type='package.pickup_reminder', status='pending',
//      correlation_id=package.id.  Status пакета остаётся awaiting_pickup.
//   3. Idempotency: повторный tick не задвоит reminder (NOT EXISTS guard в
//      findRemindCandidates).
//   4. Backdated 15 days: tick создаёт concierge follow-up, но статус остаётся
//      awaiting_pickup. Авто-возврата нет.
//   5. Backdated 31 days: tick создаёт property_admin alert, но статус остаётся
//      awaiting_pickup. Возврат по-прежнему ручной.
//
// Почему integration:
//   Unit-тесты packageSlaRunner.test.js покрывают control-flow с mock'ами
//   findRemindFn/sendRemindersFn/findFollowupFn.  Здесь же проверяем, что
//   реальный SQL (SELECT с NOT EXISTS на
//   outbox) корректно отрабатывает все четыре сценария на живой схеме v019.
//
// Prerequisite — TEST_DATABASE_URL + pgcrypto, как остальные e2e-тесты.
//   Без env — describe.skip.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

const { Pool } = require('pg');
const { createPackage, REMIND_CHANNELS } = require('../../services/packages');
const {
  tickSingleTenant,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_FOLLOWUP_AFTER_DAYS,
  DEFAULT_ADMIN_ALERT_AFTER_DAYS,
  FOLLOWUP_EVENT_TYPE,
  ADMIN_ALERT_EVENT_TYPE,
} = require('../packageSlaRunner');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('../../services/__tests__/_fixtures');

describeIfPg('platform-v1 integration: packageSlaRunner real DB', () => {
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
      console.warn('[packageSlaRunner.integration] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Helper: backdate received_at напрямую UPDATE'ом — единственный
  // практичный способ отработать SLA, не ожидая 7-15 дней реального времени.
  // ──────────────────────────────────────────────────────────────────────────
  async function backdateReceivedAt(packageId, daysAgo) {
    await pool.query(
      `UPDATE packages_v2 SET received_at = NOW() - ($1 || ' days')::INTERVAL WHERE id = $2`,
      [String(daysAgo), packageId],
    );
  }

  test('свежая посылка — tick ничего не делает', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Fresh Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
        sizeCategory: 'small',
        storageLocation: 'A1',
      });
      // У свежей посылки received_at = NOW(); tick не должен её трогать.
      const stats = await tickSingleTenant(pool, {});
      expect(stats).toEqual({
        autoReturned: 0,
        reminded: 0,
        followups: 0,
        adminAlerts: 0,
        skipped: 0,
        failed: 0,
      });

      // Status не изменился.
      const { rows: [pkgAfter] } = await pool.query(
        `SELECT status, returned_at FROM packages_v2 WHERE id = $1`, [pkg.id],
      );
      expect(pkgAfter.status).toBe('awaiting_pickup');
      expect(pkgAfter.returned_at).toBeNull();

      // Reminder outbox row отсутствует.
      const { rows: rem } = await pool.query(
        `SELECT id FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = 'package.pickup_reminder'`,
        [pkg.id],
      );
      expect(rem).toHaveLength(0);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('посылка 8 дней — tick шлёт reminder, status остаётся awaiting_pickup', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Stale Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
        sizeCategory: 'small',
        storageLocation: 'B2',
      });
      await backdateReceivedAt(pkg.id, 8);

      const stats = await tickSingleTenant(pool, {});
      expect(stats).toEqual({
        autoReturned: 0,
        reminded: 1,
        followups: 0,
        adminAlerts: 0,
        skipped: 0,
        failed: 0,
      });

      // Status НЕ менялся — 8 дней это только reminder-window.
      const { rows: [pkgAfter] } = await pool.query(
        `SELECT status, returned_at FROM packages_v2 WHERE id = $1`, [pkg.id],
      );
      expect(pkgAfter.status).toBe('awaiting_pickup');
      expect(pkgAfter.returned_at).toBeNull();

      // Reminder outbox: 1 resident × REMIND_CHANNELS rows.
      const { rows: outbox } = await pool.query(
        `SELECT status, channel, event_type
           FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = 'package.pickup_reminder'
          ORDER BY channel`,
        [pkg.id],
      );
      expect(outbox).toHaveLength(REMIND_CHANNELS.length);
      for (const r of outbox) {
        expect(r.status).toBe('pending');
        expect(REMIND_CHANNELS).toContain(r.channel);
      }
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('повторный tick идемпотентен — reminder не задваивается', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Idempotency Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
      });
      await backdateReceivedAt(pkg.id, 9);

      const stats1 = await tickSingleTenant(pool, {});
      expect(stats1.reminded).toBe(1);
      const stats2 = await tickSingleTenant(pool, {});
      // findRemindCandidates: NOT EXISTS поймает уже отправленный reminder.
      expect(stats2).toEqual({
        autoReturned: 0,
        reminded: 0,
        followups: 0,
        adminAlerts: 0,
        skipped: 0,
        failed: 0,
      });

      // Outbox count = ровно REMIND_CHANNELS, не задвоился.
      const { rows: count } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = 'package.pickup_reminder'`,
        [pkg.id],
      );
      expect(count[0].n).toBe(REMIND_CHANNELS.length);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('посылка 15 дней — tick создаёт concierge follow-up без auto-return', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1, staffRole: 'concierge' });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Overdue Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
      });
      await backdateReceivedAt(pkg.id, 15);

      const stats = await tickSingleTenant(pool, {});
      expect(stats).toEqual({
        autoReturned: 0,
        reminded: 0,
        followups: 1,
        adminAlerts: 0,
        skipped: 0,
        failed: 0,
      });

      // Статус не меняется: возврат всегда ручной.
      const { rows: [pkgAfter] } = await pool.query(
        `SELECT status, returned_at, returned_reason FROM packages_v2 WHERE id = $1`,
        [pkg.id],
      );
      expect(pkgAfter.status).toBe('awaiting_pickup');
      expect(pkgAfter.returned_at).toBeNull();
      expect(pkgAfter.returned_reason).toBeNull();

      // Reminder отсутствует, follow-up ушёл staff-получателю.
      const { rows: rem } = await pool.query(
        `SELECT id FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = 'package.pickup_reminder'`,
        [pkg.id],
      );
      expect(rem).toHaveLength(0);
      const { rows: followups } = await pool.query(
        `SELECT status, channel, recipient_type, event_type
           FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = $2`,
        [pkg.id, FOLLOWUP_EVENT_TYPE],
      );
      expect(followups).toHaveLength(1);
      expect(followups[0]).toMatchObject({
        status: 'pending',
        channel: 'web_push',
        recipient_type: 'staff',
        event_type: FOLLOWUP_EVENT_TYPE,
      });
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('посылка 31 день — tick создаёт property_admin alert без auto-return', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1, staffRole: 'property_admin' });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Critical Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
      });
      await backdateReceivedAt(pkg.id, 31);

      const stats = await tickSingleTenant(pool, {});
      expect(stats).toEqual({
        autoReturned: 0,
        reminded: 0,
        followups: 0,
        adminAlerts: 1,
        skipped: 0,
        failed: 0,
      });

      const { rows: [pkgAfter] } = await pool.query(
        `SELECT status, returned_at FROM packages_v2 WHERE id = $1`,
        [pkg.id],
      );
      expect(pkgAfter.status).toBe('awaiting_pickup');
      expect(pkgAfter.returned_at).toBeNull();

      const { rows: alerts } = await pool.query(
        `SELECT status, channel, recipient_type, event_type
           FROM notifications_outbox
          WHERE correlation_id = $1 AND event_type = $2`,
        [pkg.id, ADMIN_ALERT_EVENT_TYPE],
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        status: 'pending',
        channel: 'web_push',
        recipient_type: 'staff',
        event_type: ADMIN_ALERT_EVENT_TYPE,
      });
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('пограничный случай: reminder=7 / follow-up=14 — посылка 6 дней пропускается всеми', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId, unitId, residentIds } = fixture;

    try {
      const { package: pkg } = await createPackage(pool, {
        propertyId, unitId,
        recipientResidentId: residentIds[0],
        recipientNameSnapshot: 'Edge Recipient',
        senderName: 'Test sender',
        receivedByStaffId: staffId,
      });
      // received_at = NOW() - 6 days — не дотягивает до remindDays=7.
      await backdateReceivedAt(pkg.id, 6);

      const stats = await tickSingleTenant(pool, {
        remindDays: DEFAULT_REMINDER_AFTER_DAYS,
        followupDays: DEFAULT_FOLLOWUP_AFTER_DAYS,
        adminAlertDays: DEFAULT_ADMIN_ALERT_AFTER_DAYS,
      });
      expect(stats).toEqual({
        autoReturned: 0,
        reminded: 0,
        followups: 0,
        adminAlerts: 0,
        skipped: 0,
        failed: 0,
      });
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});
