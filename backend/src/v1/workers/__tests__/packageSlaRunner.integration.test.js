'use strict';

// platform-v1 integration e2e — packageSlaRunner SLA tick.
// Spec: packages-v2-spec.md §5 (SLA reminders + auto-return) +
// workers/packageSlaRunner.js header comment.
//
// Что проверяем end-to-end (real PostgreSQL, real packagesService.remindPackage,
// real autoReturnOverdue UPDATE):
//
//   1. Свежая посылка (received_at = NOW()) — tickSingleTenant ничего не
//      делает: { autoReturned: 0, reminded: 0 }.
//   2. Backdated 8 days (между REMIND_AFTER_DAYS=7 и AUTO_RETURN_DAYS=14):
//      tick шлёт reminder — outbox получает N residents × M channels rows
//      с event_type='package.pickup_reminder', status='pending',
//      correlation_id=package.id.  Status пакета остаётся awaiting_pickup.
//   3. Idempotency: повторный tick не задвоит reminder (NOT EXISTS guard в
//      findRemindCandidates).
//   4. Backdated 15 days (старше AUTO_RETURN_DAYS=14): tick auto-return'ит —
//      package.status='returned', returned_reason содержит '14 дней',
//      reminder НЕ шлётся (auto-return в tick'е выполняется ПЕРВЫМ и убирает
//      строку из awaiting_pickup до reminder-запроса).
//
// Почему integration:
//   Unit-тесты packageSlaRunner.test.js покрывают control-flow с mock'ами
//   autoReturnFn/findRemindFn/sendRemindersFn.  Здесь же проверяем, что
//   реальный SQL (UPDATE с WHERE LIMIT subquery, SELECT с NOT EXISTS на
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
  AUTO_RETURN_REASON,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_AUTO_RETURN_AFTER_DAYS,
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
      expect(stats).toEqual({ autoReturned: 0, reminded: 0, skipped: 0, failed: 0 });

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
        skipped: 0,
        failed: 0,
      });

      // Status НЕ менялся — auto-return не сработал (8 < 14).
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
      expect(stats2).toEqual({ autoReturned: 0, reminded: 0, skipped: 0, failed: 0 });

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

  test('посылка 15 дней — tick auto-return\'ит, reminder НЕ шлётся', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
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
      // auto-return = 1, reminder не запускается на возвращённую (status уже
      // 'returned' — findRemindCandidates фильтрует по awaiting_pickup).
      expect(stats).toEqual({
        autoReturned: 1,
        reminded: 0,
        skipped: 0,
        failed: 0,
      });

      // Status='returned', returned_reason ссылается на дни (см. AUTO_RETURN_REASON).
      const { rows: [pkgAfter] } = await pool.query(
        `SELECT status, returned_at, returned_reason FROM packages_v2 WHERE id = $1`,
        [pkg.id],
      );
      expect(pkgAfter.status).toBe('returned');
      expect(pkgAfter.returned_at).not.toBeNull();
      expect(pkgAfter.returned_reason).toContain(AUTO_RETURN_REASON);
      expect(pkgAfter.returned_reason).toContain(String(DEFAULT_AUTO_RETURN_AFTER_DAYS));

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

  test('пограничный случай: reminder=7 / auto-return=14 — посылка 7 дней пропускается обоими', async () => {
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
        returnDays: DEFAULT_AUTO_RETURN_AFTER_DAYS,
      });
      expect(stats).toEqual({ autoReturned: 0, reminded: 0, skipped: 0, failed: 0 });
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});
