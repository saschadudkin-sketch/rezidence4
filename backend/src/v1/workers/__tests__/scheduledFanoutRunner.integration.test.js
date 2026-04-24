'use strict';

// platform-v1 integration e2e — scheduledFanoutRunner cron tick.
// Spec: announcements-v2-spec.md §3 («scheduled → active» transition) + §4.5
// (cron tick semantics) + workers/scheduledFanoutRunner.js header comment.
//
// Что проверяем end-to-end (real PostgreSQL, реальный
// announcementsService.runScheduledFanout):
//
//   1. Scheduled announcement с starts_at в БУДУЩЕМ → tick НЕ должен fan-out'ить
//      (spec §3: fan-out только когда starts_at ≤ NOW()).
//   2. Тот же announcement, после backdate'а starts_at в прошлое → tick
//      делает fan-out: outbox получает N residents × M channels rows со
//      status='pending', correlation_id=announcement.id, event_type=
//      'announcement.published'.
//   3. Idempotency: повторный tick по уже отработанному announcement не
//      создаёт повторных outbox rows (NOT EXISTS guard в runScheduledFanout).
//   4. tickAllProperties multi-tenant обвязка: один объект с announcement
//      → один результат в массиве с непустым fanout array.
//
// Почему именно integration:
//   Unit-тесты scheduledFanoutRunner.test.js покрывают control-flow с
//   mock'ами runScheduledFanout/listActiveProperties.  Здесь же мы проверяем,
//   что РЕАЛЬНЫЙ SQL в runScheduledFanout ведёт себя так, как утверждает
//   spec §3: SELECT FOR UPDATE SKIP LOCKED + NOT EXISTS правильно фильтрует
//   уже обработанные строки и реально пишет в outbox.
//
// Prerequisite — тот же, что для announcements.e2e.integration.test.js:
//   TEST_DATABASE_URL (или DATABASE_URL fallback), pgcrypto extension.
//   См. backend/README.md §«platform-v1 integration tests».
//
// Isolation: per-test seed/cleanup по property_id, как в _fixtures.js.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

const { Pool } = require('pg');
const { createAnnouncement, publishAnnouncement } = require('../../services/announcements');
const { tickAllProperties } = require('../scheduledFanoutRunner');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('../../services/__tests__/_fixtures');

describeIfPg('platform-v1 integration: scheduledFanoutRunner real DB', () => {
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
      console.warn('[scheduledFanoutRunner.integration] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Helper: вызвать runScheduledFanout() напрямую через tickAllProperties.
  // Используем in-memory platformDb, который возвращает один property с
  // нашим тестовым propertyId — getPool() отдаёт всегда один и тот же pool.
  // ──────────────────────────────────────────────────────────────────────────
  function makeFakePlatformDb(propertyId, slug = 'integration-test') {
    return {
      query: jest.fn().mockResolvedValue({
        rows: [{ id: propertyId, slug, db_connection_url: 'unused' }],
      }),
    };
  }
  function makeGetPool() {
    return () => pool;
  }

  test('starts_at в будущем → tick не fan-out\'ит', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 2 });
    const { propertyId, staffId } = fixture;

    try {
      // Создаём announcement со starts_at через час → scheduled.
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'Future schedule',
        bodyMd: 'Не должно fan-out\'иться сейчас.',
        audienceType: 'all',
        notifyChannels: ['web_push'],
        startsAt: future.toISOString(),
        createdByStaffId: staffId,
      });
      // Publish — ставит published_at, но fan-out внутри publishAnnouncement
      // не сработает, т.к. starts_at > now (см. publishAnnouncement, ветка
      // startsAtMs > nowMs).
      const pub = await publishAnnouncement(pool, draft.id, staffId);
      expect(pub.conflict).toBeNull();
      expect(pub.outboxRows).toHaveLength(0);

      // Tick — listActiveProperties вернёт наш «property», fanoutFn (=real)
      // должен ничего не сделать (starts_at > NOW() → SQL фильтр исключает).
      const results = await tickAllProperties({
        platformDb: makeFakePlatformDb(propertyId),
        getPool: makeGetPool(),
        batchSize: 20,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ slug: 'integration-test', fanout: [] });

      // Sanity: outbox для этого announcement действительно пуст.
      const { rows: outbox } = await pool.query(
        `SELECT id FROM notifications_outbox WHERE correlation_id = $1`,
        [draft.id],
      );
      expect(outbox).toHaveLength(0);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('starts_at в прошлом → tick fan-out\'ит outbox = N residents × M channels', async () => {
    if (!dbReady) return;
    const N = 3;
    const fixture = await seedFixture(pool, { residentCount: N });
    const { propertyId, staffId } = fixture;

    try {
      // Создаём draft в будущем, publish'им (без fan-out'а), затем
      // backdate'им starts_at в прошлое — имитируем, что таймер дошёл.
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'Backdated to past',
        bodyMd: 'Tick должен fan-out\'ить эту строку.',
        audienceType: 'all',
        notifyChannels: ['web_push', 'sms'],
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        createdByStaffId: staffId,
      });
      await publishAnnouncement(pool, draft.id, staffId);

      // Backdate: имитируем «время пришло» через UPDATE.  Это easier чем ждать.
      await pool.query(
        `UPDATE announcements_v2 SET starts_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [draft.id],
      );

      const results = await tickAllProperties({
        platformDb: makeFakePlatformDb(propertyId),
        getPool: makeGetPool(),
        batchSize: 20,
      });
      expect(results).toHaveLength(1);
      expect(results[0].fanout).toHaveLength(1);
      // outbox_count = N residents × 2 channels.
      expect(results[0].fanout[0]).toMatchObject({ id: draft.id, outbox_count: N * 2 });

      // Verify DB-state: rows реально лежат в outbox.
      const { rows: outbox } = await pool.query(
        `SELECT status, channel, recipient_type, event_type, recipient_id
           FROM notifications_outbox
          WHERE correlation_id = $1
          ORDER BY recipient_id, channel`,
        [draft.id],
      );
      expect(outbox).toHaveLength(N * 2);
      for (const r of outbox) {
        expect(r.status).toBe('pending');
        expect(r.recipient_type).toBe('resident');
        expect(r.event_type).toBe('announcement.published');
        expect(['web_push', 'sms']).toContain(r.channel);
      }
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('повторный tick идемпотентен — NOT EXISTS блокирует двойной fan-out', async () => {
    if (!dbReady) return;
    const N = 2;
    const fixture = await seedFixture(pool, { residentCount: N });
    const { propertyId, staffId } = fixture;

    try {
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'Idempotency check',
        bodyMd: 'Второй tick не должен задвоить outbox.',
        audienceType: 'all',
        notifyChannels: ['web_push'],
        startsAt: new Date(Date.now() - 60 * 1000).toISOString(),  // уже в прошлом
        createdByStaffId: staffId,
      });
      // publish — сразу fan-out'ит, потому что starts_at ≤ now.
      const pub = await publishAnnouncement(pool, draft.id, staffId);
      expect(pub.outboxRows).toHaveLength(N);

      // Первый tick — найдёт уже отработанный announcement (NOT EXISTS — false,
      // т.к. outbox rows есть) → fanout пустой.
      const tick1 = await tickAllProperties({
        platformDb: makeFakePlatformDb(propertyId),
        getPool: makeGetPool(),
        batchSize: 20,
      });
      expect(tick1[0].fanout).toEqual([]);

      // Второй tick — то же самое.
      const tick2 = await tickAllProperties({
        platformDb: makeFakePlatformDb(propertyId),
        getPool: makeGetPool(),
        batchSize: 20,
      });
      expect(tick2[0].fanout).toEqual([]);

      // Outbox count не изменился — всё ещё ровно N.
      const { rows: count } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notifications_outbox WHERE correlation_id = $1`,
        [draft.id],
      );
      expect(count[0].n).toBe(N);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('per-property isolation — сломанный getPool у одного property не валит остальные', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool, { residentCount: 1 });
    const { propertyId, staffId } = fixture;

    try {
      const draft = await createAnnouncement(pool, {
        propertyId,
        title: 'Isolation healthy property',
        bodyMd: 'Должно fan-out\'иться в обход broken соседа.',
        audienceType: 'all',
        notifyChannels: ['web_push'],
        startsAt: new Date(Date.now() - 60 * 1000).toISOString(),
        createdByStaffId: staffId,
      });

      // Имитируем listActiveProperties с двумя property: первый «broken»,
      // второй — наш реальный propertyId.  getPool бросает на broken и
      // отдаёт реальный pool на healthy.
      const platformDb = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { id: '00000000-0000-0000-0000-000000000bad', slug: 'broken', db_connection_url: 'x' },
            { id: propertyId,                              slug: 'healthy', db_connection_url: 'y' },
          ],
        }),
      };
      const getPool = (p) => {
        if (p.slug === 'broken') throw new Error('pool unavailable');
        return pool;
      };
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

      const results = await tickAllProperties({ platformDb, getPool, batchSize: 20, logger });
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ slug: 'broken', error: 'pool unavailable' });
      expect(results[1].slug).toBe('healthy');
      // fan-out на healthy состоялся (1 resident × 1 channel).
      expect(results[1].fanout).toHaveLength(1);
      expect(results[1].fanout[0]).toMatchObject({ id: draft.id, outbox_count: 1 });
      // Логгер словил error для broken.
      expect(logger.error).toHaveBeenCalled();
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});
