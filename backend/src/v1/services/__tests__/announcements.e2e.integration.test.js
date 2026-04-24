'use strict';

// platform-v1 integration e2e — announcements_v2 fan-out pipeline.
// Spec: announcements-v2-spec.md §7 AC:
//   «Интеграционный тест e2e: create → publish → outbox rows → notification_log_v2 rows
//    — counts совпадают с audience size × channels»
//
// Что проверяем end-to-end (пять шагов одного сценария):
//   1. createAnnouncement() — draft без published_at
//   2. publishAnnouncement() — транзакционный fan-out в notifications_outbox
//   3. DB-состояние outbox: N rows, status='pending', channel='web_push'
//   4. outboxWorker.processBatch() — с замоканым channels.dispatch (ok:true)
//   5. DB-состояние log_v2: N rows linked к outbox через outbox_id
//      + outbox rows все переходят в status='sent'
//
// Prerequisite:
//   - PostgreSQL доступен через TEST_DATABASE_URL (или DATABASE_URL fallback).
//   - `pgcrypto` extension (для gen_random_uuid()) должен быть установлен —
//     в Windows / свежей БД: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.
//   - Тест применяет V1_PROPERTY_MIGRATIONS идемпотентно (IF NOT EXISTS guards).
//   - Если env не задан — describe.skip; тест не ломает CI без БД.
//
// Isolation:
//   - Seed создаётся в beforeAll-like helper, cleanup в finally — удаляем
//     только то, что сами вставили (фильтр по property_id).  Тест не
//     транзакционен целиком, потому что publishAnnouncement сам открывает
//     транзакцию (SELECT FOR UPDATE).  Tested-entity-scoped cleanup лучше
//     для параллельных тестов в одном schema.
//
// Что НЕ проверяем (out of scope этого файла):
//   - Каналы-specific serialization (email subject/body, push payload format)
//     — это unit-тесты на channels/*.js.
//   - runScheduledFanout() (starts_at > NOW()) — отдельный кейс, spec §3.
//   - Rate-limiters на HTTP routes (createLimiter 10/hr) — тест идёт на
//     service-level, HTTP слой исключён.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

// channels.dispatch mock — ДО require outboxWorker'а, чтобы Jest подхватил factory.
// mockResolvedValue({ok:true}) заставит processRow уйти в success path:
//   UPDATE outbox SET status='sent' + INSERT notification_log_v2 status='sent'.
jest.mock('../channels', () => ({
  dispatch: jest.fn().mockResolvedValue({
    ok: true,
    providerMessageId: 'mock-msg-id',
  }),
}));

const { Pool } = require('pg');
const { createAnnouncement, publishAnnouncement } = require('../announcements');
const outboxWorker = require('../../workers/outboxWorker');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('./_fixtures');

describeIfPg('platform-v1 integration e2e: announcements fan-out', () => {
  /** @type {Pool} */
  let pool;
  let dbReady = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query('SELECT 1');
      // pgcrypto для gen_random_uuid() — на fresh БД может отсутствовать.
      // IF NOT EXISTS идемпотентно.
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await applyV1Migrations(pool);
      dbReady = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[announcements.e2e] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('counts: N residents × M channels = N*M outbox rows = N*M notification_log_v2 rows', async () => {
    if (!dbReady) return;
    const N = 3;
    const fixture = await seedFixture(pool, { residentCount: N });
    const { propertyId, staffId } = fixture;

    try {
      // 1. Draft → no publish flags.
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'E2E fan-out check',
        bodyMd: 'Plain text body for integration test.',
        audienceType: 'all',
        notifyChannels: ['web_push'],
        createdByStaffId: staffId,
      });
      expect(draft.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(draft.published_at).toBeNull();
      expect(draft.property_id).toBe(propertyId);

      // 2. Publish — транзакционный fan-out (starts_at = now() по default).
      const result = await publishAnnouncement(pool, draft.id, staffId);
      expect(result.conflict).toBeNull();
      expect(result.row.published_at).not.toBeNull();
      expect(result.outboxRows).toHaveLength(N); // audience=N × channels=1

      // 3. Outbox state: pending, correct channel/type.
      const { rows: outboxBefore } = await pool.query(
        `SELECT status, channel, recipient_type, event_type
           FROM notifications_outbox
          WHERE correlation_id = $1`,
        [draft.id],
      );
      expect(outboxBefore).toHaveLength(N);
      for (const r of outboxBefore) {
        expect(r.status).toBe('pending');
        expect(r.channel).toBe('web_push');
        expect(r.recipient_type).toBe('resident');
        expect(r.event_type).toBe('announcement.published');
      }

      // 4. Worker processes batch — channels.dispatch замокан ok:true.
      const stats = await outboxWorker.processBatch(pool);
      expect(stats.sent).toBe(N);
      expect(stats.failed).toBe(0);
      expect(stats.dead).toBe(0);
      expect(stats.errors).toBe(0);

      // 5a. Outbox → все sent.
      const { rows: outboxAfter } = await pool.query(
        `SELECT status, sent_at FROM notifications_outbox WHERE correlation_id = $1`,
        [draft.id],
      );
      for (const r of outboxAfter) {
        expect(r.status).toBe('sent');
        expect(r.sent_at).not.toBeNull();
      }

      // 5b. log_v2: ровно N rows, все status='sent', outbox_id matches.
      const { rows: logRows } = await pool.query(
        `SELECT l.status, l.channel, l.event_type, l.outbox_id
           FROM notification_log_v2 l
          WHERE l.outbox_id IN (
            SELECT id FROM notifications_outbox WHERE correlation_id = $1
          )`,
        [draft.id],
      );
      expect(logRows).toHaveLength(N);
      for (const r of logRows) {
        expect(r.status).toBe('sent');
        expect(r.channel).toBe('web_push');
        expect(r.event_type).toBe('announcement.published');
        expect(r.outbox_id).not.toBeNull();
      }
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('multi-channel: N residents × 2 channels = 2N outbox rows = 2N log rows', async () => {
    if (!dbReady) return;
    const N = 2;
    const fixture = await seedFixture(pool, { residentCount: N });
    const { propertyId, staffId } = fixture;

    try {
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'Multi-channel fan-out',
        bodyMd: 'Body.',
        audienceType: 'all',
        notifyChannels: ['web_push', 'email'],
        createdByStaffId: staffId,
      });
      const { outboxRows } = await publishAnnouncement(pool, draft.id, staffId);
      expect(outboxRows).toHaveLength(N * 2); // residents × channels

      const stats = await outboxWorker.processBatch(pool);
      expect(stats.sent).toBe(N * 2);

      const { rows: logRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notification_log_v2
          WHERE outbox_id IN (
            SELECT id FROM notifications_outbox WHERE correlation_id = $1
          )`,
        [draft.id],
      );
      expect(logRows[0].n).toBe(N * 2);

      // Distinct channels.
      const { rows: channels } = await pool.query(
        `SELECT DISTINCT channel FROM notification_log_v2
          WHERE outbox_id IN (
            SELECT id FROM notifications_outbox WHERE correlation_id = $1
          )
          ORDER BY channel`,
        [draft.id],
      );
      expect(channels.map((c) => c.channel)).toEqual(['email', 'web_push']);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});

// Helpers — applyV1Migrations / seedFixture / cleanupFixture — вынесены
// в ./_fixtures.js.  Отдельный файл `_fixtures.js` под __tests__/ скрыт
// от jest test discovery через testPathIgnorePatterns `/__tests__/_` в
// backend/package.json.
