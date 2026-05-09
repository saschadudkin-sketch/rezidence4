'use strict';

// platform-v1 integration e2e — packageSla snapshot service against real postgres.
// Spec: packages-v2-spec.md §5 (SLA reminders + follow-up/admin alerts) + packageSla.js
// header comment.
//
// Почему отдельный integration-тест:
//   Сервис packageSla.js читает из packages_v2 + notifications_outbox через
//   FILTER-aggregate'ы и INTERVAL-арифметику.  Unit-тесты с mock'ами не
//   ловят SQL-ошибки («column "foo" does not exist», неверный тип CAST,
//   сломанный INTERVAL-literal).  Это ровно тот endpoint, который scrape'ится
//   Prometheus'ом каждые 15s — ломаться не имеет права.
//
// Стратегия изоляции — diff-подход.  getPackageSlaSnapshot читает ВСЕ строки
// packages_v2 (в prod это per-tenant DB, но в integration мы делим одну БД
// между параллельными тестами).  Поэтому:
//   1. S1 = snapshot BEFORE seeding
//   2. seed(N known rows)
//   3. S2 = snapshot AFTER seeding
//   4. assert S2 - S1 == expected deltas
//
// Prerequisite: TEST_DATABASE_URL (или DATABASE_URL fallback), pgcrypto.
// Без env — describe.skip (same pattern как в announcements/packages/
// documents e2e + scheduledFanoutRunner.integration).

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

const { Pool } = require('pg');
const {
  getPackageSlaSnapshot,
  renderSlaAsPrometheus,
  FOLLOWUP_EVENT_TYPE,
  ADMIN_ALERT_EVENT_TYPE,
} = require('../packageSla');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('./_fixtures');

describeIfPg('platform-v1 integration: packageSla snapshot real DB', () => {
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
      console.warn('[packageSla.integration] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('snapshot shape + delta counts match seeded rows', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, unitId, staffId, residentIds } = fixture;
    const residentId = residentIds[0];

    try {
      // ─── Baseline snapshot ──────────────────────────────────────────────
      const s1 = await getPackageSlaSnapshot(pool);

      // Shape-assert: все SLA gauge'и + thresholds + generated_at.
      expect(s1).toEqual(expect.objectContaining({
        awaiting_pickup_total:    expect.any(Number),
        awaiting_pickup_over_7d:  expect.any(Number),
        awaiting_pickup_over_14d: expect.any(Number),
        awaiting_pickup_over_30d: expect.any(Number),
        reminders_sent_24h:       expect.any(Number),
        followups_sent_24h:       expect.any(Number),
        admin_alerts_sent_24h:    expect.any(Number),
        received_24h:             expect.any(Number),
        thresholds: { remind_days: 7, followup_days: 14, admin_alert_days: 30 },
        generated_at: expect.any(String),
      }));
      expect(() => new Date(s1.generated_at).toISOString()).not.toThrow();

      // ─── Seed known rows ────────────────────────────────────────────────
      // 1 fresh awaiting_pickup (received 2 дня назад — НЕ попадает ни в
      //   over_7d, ни в over_14d, но попадает в awaiting_pickup_total).
      // 1 over_7d (received 9 дней назад — попадает в awaiting_pickup_total
      //   + awaiting_pickup_over_7d).
      // 1 over_14d (received 15 дней назад — bucket ≥14 AND <30).
      // 1 over_30d (received 31 день назад — bucket ≥30).
      // Плюс outbox rows для reminder/follow-up/admin-alert.
      const insertPkg = async (offsets) => {
        const { rows: [r] } = await pool.query(
          `INSERT INTO packages_v2
             (property_id, unit_id, recipient_resident_id, received_at,
              received_by_staff_id, status, storage_location,
              picked_up_at, picked_up_by_staff_id, picked_up_by_resident_id,
              returned_at, returned_reason)
           VALUES ($1,$2,$3, NOW() - ($4 || ' days')::INTERVAL,
                   $5, $6, 'A1', $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            propertyId, unitId, residentId,
            String(offsets.receivedDaysAgo),
            staffId, offsets.status,
            offsets.pickedUpAt || null,
            offsets.pickedUpByStaffId || null,
            offsets.pickedUpByResidentId || null,
            offsets.returnedAt || null,
            offsets.returnedReason || null,
          ],
        );
        return r.id;
      };

      await insertPkg({ receivedDaysAgo: 2,  status: 'awaiting_pickup' });
      await insertPkg({ receivedDaysAgo: 9,  status: 'awaiting_pickup' });
      await insertPkg({ receivedDaysAgo: 15, status: 'awaiting_pickup' });
      await insertPkg({ receivedDaysAgo: 31, status: 'awaiting_pickup' });

      // Outbox rows for all SLA events.
      await pool.query(
        `INSERT INTO notifications_outbox
           (property_id, event_type, recipient_type, recipient_id, channel,
            correlation_id, status, payload)
         VALUES
           ($1, 'package.pickup_reminder', 'resident', $2, 'sms',
            gen_random_uuid(), 'pending', '{}'::jsonb),
           ($1, 'package.pickup_reminder', 'resident', $2, 'web_push',
            gen_random_uuid(), 'pending', '{}'::jsonb),
           ($1, $3, 'staff', $4, 'web_push',
            gen_random_uuid(), 'pending', '{}'::jsonb),
           ($1, $5, 'staff', $4, 'web_push',
            gen_random_uuid(), 'pending', '{}'::jsonb)`,
        [propertyId, residentId, FOLLOWUP_EVENT_TYPE, staffId, ADMIN_ALERT_EVENT_TYPE],
      );

      // ─── Post-seed snapshot ─────────────────────────────────────────────
      const s2 = await getPackageSlaSnapshot(pool);

      // awaiting_pickup_total: +4 (fresh + over_7d + over_14d + over_30d).
      expect(s2.awaiting_pickup_total - s1.awaiting_pickup_total).toBe(4);
      // over_7d bucket: [7 days, 14 days) — только 9-day package попадает.
      expect(s2.awaiting_pickup_over_7d - s1.awaiting_pickup_over_7d).toBe(1);
      // over_14d bucket: [14 days, 30 days) — только 15-day package.
      expect(s2.awaiting_pickup_over_14d - s1.awaiting_pickup_over_14d).toBe(1);
      // over_30d bucket: только 31-day package.
      expect(s2.awaiting_pickup_over_30d - s1.awaiting_pickup_over_30d).toBe(1);
      // reminders_sent_24h: +2 outbox rows.
      expect(s2.reminders_sent_24h - s1.reminders_sent_24h).toBe(2);
      expect(s2.followups_sent_24h - s1.followups_sent_24h).toBe(1);
      expect(s2.admin_alerts_sent_24h - s1.admin_alerts_sent_24h).toBe(1);
      // received_24h: 4 пакета, НО received_at у каждого в прошлом (2/9/15/31
      //   дней назад), значит НИ ОДИН не попадает в «последние 24h».
      expect(s2.received_24h - s1.received_24h).toBe(0);

      // ─── Prometheus exposition ───────────────────────────────────────────
      const prom = renderSlaAsPrometheus(s2, { propertySlug: 'integration-test' });
      expect(prom).toMatch(/# HELP package_sla_awaiting_pickup /);
      expect(prom).toMatch(/# TYPE package_sla_awaiting_pickup gauge/);
      expect(prom).toMatch(/package_sla_awaiting_pickup\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_awaiting_pickup_over_7d\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_awaiting_pickup_over_14d\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_awaiting_pickup_over_30d\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_reminders_sent_24h\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_followups_sent_24h\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_admin_alerts_sent_24h\{property="integration-test"\} \d+/);
      expect(prom).toMatch(/package_sla_received_24h\{property="integration-test"\} \d+/);
      // Финальный newline (Prometheus требует, чтобы последняя строка была
      // завершена '\n', см. exposition format spec).
      expect(prom.endsWith('\n')).toBe(true);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('custom thresholds (remindDays=3, followupDays=10) корректно применяются', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, unitId, staffId, residentIds } = fixture;
    const residentId = residentIds[0];

    try {
      // Baseline с кастомными порогами.
      const s1 = await getPackageSlaSnapshot(pool, {
        remindDays: 3,
        followupDays: 10,
        adminAlertDays: 20,
      });
      expect(s1.thresholds).toEqual({
        remind_days: 3,
        followup_days: 10,
        admin_alert_days: 20,
      });

      // 5 дней назад — при default (7/14) не в over_7d; при custom (3/10)
      // попадает в over_7d (name gauge'а остался старый, но SQL-порог
      // изменился).
      await pool.query(
        `INSERT INTO packages_v2
           (property_id, unit_id, recipient_resident_id, received_at,
            received_by_staff_id, status, storage_location)
         VALUES ($1, $2, $3, NOW() - INTERVAL '5 days', $4,
                 'awaiting_pickup', 'B7')`,
        [propertyId, unitId, residentId, staffId],
      );

      const s2 = await getPackageSlaSnapshot(pool, {
        remindDays: 3,
        followupDays: 10,
        adminAlertDays: 20,
      });
      expect(s2.awaiting_pickup_total    - s1.awaiting_pickup_total).toBe(1);
      expect(s2.awaiting_pickup_over_7d  - s1.awaiting_pickup_over_7d).toBe(1);
      expect(s2.awaiting_pickup_over_14d - s1.awaiting_pickup_over_14d).toBe(0);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('invalid thresholds → throw', async () => {
    if (!dbReady) return;
    await expect(getPackageSlaSnapshot(pool, { remindDays: 0, followupDays: 14 }))
      .rejects.toThrow(/remindDays > 0/);
    await expect(getPackageSlaSnapshot(pool, { remindDays: 7, followupDays: 5 }))
      .rejects.toThrow(/followupDays > remindDays/);
    await expect(getPackageSlaSnapshot(pool, { remindDays: 7, followupDays: 14, adminAlertDays: 14 }))
      .rejects.toThrow(/adminAlertDays > followupDays/);
  }, 15_000);

  test('pool без .query → throw', async () => {
    await expect(getPackageSlaSnapshot(null))
      .rejects.toThrow(/db with \.query required/);
    await expect(getPackageSlaSnapshot({}))
      .rejects.toThrow(/db with \.query required/);
  });
});
