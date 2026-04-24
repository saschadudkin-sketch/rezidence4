'use strict';

// platform-v1 scheduled-fanout runner — Spec: announcements-v2-spec.md §3
// («scheduled → active» transition) + §4.5 (cron tick).
//
// Что делает:
//   announcementsService.runScheduledFanout(pool) — одна транзакция на объект,
//   SELECT FOR UPDATE SKIP LOCKED на пачке announcements_v2, у которых
//   published_at <= NOW() AND starts_at <= NOW() AND нет outbox rows.  Для
//   каждой такой строки fan-out'им на audience и batch-inserts в outbox.
//   Функция уже написана; мы только вызываем её периодически.
//
// Зачем отдельный runner:
//   - runtimeJobs.js принципиально single-tenant (один db), а scheduled fanout
//     у нас multi-tenant по природе.  Смешивать модели — путь к багам.
//   - Паттерн копирует outboxRunner.js: gate по NOTIFICATIONS_OUTBOX_ENABLED,
//     multi-tenant итерация или fallback single-tenant, per-tenant try/catch,
//     setInterval с .unref(), экспорт helper'ов для тестов.
//
// Частота:
//   Default 60 секунд.  UX-требование «≤ минута между starts_at и тем что
//   резидент увидит в feed» достаточно для non-urgent объявлений; urgent
//   публикуются сразу (publish endpoint вызывает fanout синхронно).
//
// Изоляция ошибок:
//   Один плохой tenant (нет БД, сломана миграция) не должен ронять весь tick —
//   per-tenant try/catch с логом.

const defaultLogger = require('../../logger');
const { isOutboxEnabled } = require('../services/notificationOutbox');
const announcementsService = require('../services/announcements');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_PROPERTY_ID = 'default';

// Тот же SELECT, что в outboxRunner — source of truth для «какие tenant'ы
// активны».  Держим локальную копию, чтобы не зависеть от internals
// outboxRunner'а (их циклы и контракты могут расходиться).
async function listActiveProperties(platformDb) {
  if (!platformDb || typeof platformDb.query !== 'function') {
    throw new Error('listActiveProperties: platformDb with .query required');
  }
  const { rows } = await platformDb.query(
    `SELECT id, slug, db_connection_url
       FROM properties
      WHERE is_active = true
      ORDER BY slug`,
  );
  return rows;
}

/**
 * tickAllProperties — один цикл «обойти все active tenants».
 *
 * Per-tenant try/catch: dead pool / broken schema в одном property не должен
 * ронять обход.  Логируем и двигаемся дальше.
 *
 * Возвращаем массив { slug, fanout: [{ id, outbox_count }] | undefined,
 *                     error } — для тестов и admin-introspection.
 */
async function tickAllProperties(args) {
  const {
    platformDb,
    getPool,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    fanoutFn = announcementsService.runScheduledFanout,
  } = args || {};

  if (typeof getPool !== 'function') {
    throw new Error('tickAllProperties: getPool(property) function required');
  }

  const properties = await listActiveProperties(platformDb);
  const results = [];

  for (const p of properties) {
    try {
      const pool = getPool(p);
      const fanout = await fanoutFn(pool, { batchSize });
      if (fanout.length > 0) {
        logger.info(
          {
            slug: p.slug,
            announcements: fanout.length,
            total_outbox: fanout.reduce((sum, s) => sum + (s.outbox_count || 0), 0),
          },
          '[scheduled-fanout] fanned out scheduled announcements',
        );
      }
      results.push({ slug: p.slug, fanout });
    } catch (err) {
      logger.error(
        { err: err.message, slug: p.slug },
        '[scheduled-fanout] tick failed for property',
      );
      results.push({ slug: p.slug, error: err.message });
    }
  }

  return results;
}

/**
 * startScheduledFanoutRunner — единственная публичная точка запуска.
 *
 * @param {object} opts
 * @param {?object}   opts.platformDb     pg pool для platform registry
 * @param {?Function} opts.getPool        (property) → pg pool; нужен если platformDb
 * @param {?object}   opts.fallbackDb     pg pool tenant'а (single-tenant dev)
 * @param {?number}   opts.intervalMs     tick period (default 60_000)
 * @param {?number}   opts.batchSize      batch size (default 20)
 * @param {?object}   opts.logger         DI, default: require('../../logger')
 * @param {?Function} opts.fanoutFn       тест-hook для подмены runScheduledFanout
 * @returns {{ stop(): void, started: boolean, mode: string, reason?: string }}
 */
function startScheduledFanoutRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    fanoutFn = announcementsService.runScheduledFanout,
  } = opts;

  // ── gate #1: общий feature flag (объявления в продакшне идут через outbox
  //             — без него fan-out ляжет в «зависшие» pending rows).
  if (!isOutboxEnabled()) {
    logger.info(
      '[scheduled-fanout] NOTIFICATIONS_OUTBOX_ENABLED=false — runner not started',
    );
    return {
      stop() { /* noop */ },
      started: false,
      mode: 'disabled',
      reason: 'flag_disabled',
    };
  }

  // ── gate #2: либо multi-tenant (platformDb + getPool), либо fallback
  const hasMultiTenant = Boolean(platformDb && typeof getPool === 'function');
  const hasSingleTenant = Boolean(fallbackDb);

  if (!hasMultiTenant && !hasSingleTenant) {
    logger.warn(
      '[scheduled-fanout] neither platformDb+getPool nor fallbackDb provided — runner not started',
    );
    return {
      stop() { /* noop */ },
      started: false,
      mode: 'disabled',
      reason: 'no_db',
    };
  }

  // ── single-tenant path (dev) ────────────────────────────────────────────
  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        const fanout = await fanoutFn(fallbackDb, { batchSize });
        if (fanout.length > 0) {
          logger.info(
            {
              property: DEFAULT_PROPERTY_ID,
              announcements: fanout.length,
              total_outbox: fanout.reduce((s, r) => s + (r.outbox_count || 0), 0),
            },
            '[scheduled-fanout] single-tenant fanned out',
          );
        }
      } catch (err) {
        logger.error(
          { err: err.message },
          '[scheduled-fanout] single-tenant tick failed',
        );
      }
    };
    const tickTimer = setInterval(tick, intervalMs);
    if (typeof tickTimer.unref === 'function') tickTimer.unref();

    logger.info(
      { mode: 'single-tenant', intervalMs, batchSize },
      '[scheduled-fanout] started',
    );
    return {
      started: true,
      mode: 'single-tenant',
      stop() { clearInterval(tickTimer); },
    };
  }

  // ── multi-tenant path (prod) ────────────────────────────────────────────
  const tick = async () => {
    try {
      await tickAllProperties({ platformDb, getPool, batchSize, logger, fanoutFn });
    } catch (err) {
      // listActiveProperties rejected — platform DB flakey.  Логируем,
      // следующий tick попробует снова.  НЕ ломаем interval.
      logger.error(
        { err: err.message },
        '[scheduled-fanout] tick loop caught error',
      );
    }
  };
  const tickTimer = setInterval(tick, intervalMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();

  logger.info(
    { mode: 'multi-tenant', intervalMs, batchSize },
    '[scheduled-fanout] started',
  );
  return {
    started: true,
    mode: 'multi-tenant',
    stop() { clearInterval(tickTimer); },
  };
}

module.exports = {
  startScheduledFanoutRunner,
  // exported for tests + admin introspection:
  listActiveProperties,
  tickAllProperties,
  DEFAULT_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_PROPERTY_ID,
};
