'use strict';

// platform-v1 notifications outbox runner — Spec: notifications-outbox-spec.md §4.5.
//
// `outboxWorker.runOnce` ничего не знает про setInterval, про список tenant'ов,
// про stuck rows и про health.  Этот модуль — тонкая обёртка, которая:
//   (1) тикает по всем активным properties из платформенного реестра и
//       вызывает worker.runOnce(pool, {propertyId}) для каждого;
//   (2) раз в 5 минут реанимирует «зависшие» строки `in_flight` (reaper);
//   (3) умеет graceful-stop (clearInterval обоих таймеров).
//
// Зачем отдельный файл:
//   - runtimeJobs.js принципиально legacy/per-property (принимает один db).
//     Outbox же multi-tenant по природе — он итерирует ВСЕ properties из
//     platform-реестра.  Смешивать две модели в одном файле запутало бы
//     и тесты, и shutdown.
//   - Так же проще подменить в unit-тестах: вместо setInterval(...) можно
//     дёрнуть экспортированную tickAllProperties({...}) напрямую.
//
// Feature flag:
//   runner стартует только если `NOTIFICATIONS_OUTBOX_ENABLED` === truthy.
//   Иначе мгновенный no-op с объяснительным логом — это cut-over gate, а не
//   ошибка (flag OFF = «ещё не готовы катить outbox в этом окружении»).
//
// Режимы:
//   multi-tenant  — PLATFORM_DB_URL задан → итерация по properties.
//   single-tenant — PLATFORM_DB_URL не задан → тикаем один раз на fallbackDb
//                   (dev-окружение без platform registry).  propertyId='default'.
//
// Ошибки per-tenant изолируем: один плохой property не должен ронять весь tick.

const defaultLogger = require('../../logger');
const worker = require('./outboxWorker');
const { isOutboxEnabled } = require('../services/notificationOutbox');

const DEFAULT_INTERVAL_MS       = 30 * 1000;        // main tick
const DEFAULT_REAP_INTERVAL_MS  = 5 * 60 * 1000;    // reaper sub-loop
const DEFAULT_STUCK_TTL_MINUTES = 30;               // anything in_flight older → revive
const DEFAULT_BATCH_SIZE        = 50;
const DEFAULT_PROPERTY_ID       = 'default';        // single-tenant fallback key

// ─── registry & pool access ───────────────────────────────────────────────────

/**
 * listActiveProperties — один SELECT из `properties`.  Возвращает минимальный
 * набор колонок, которых хватит для getPool + worker.runOnce.
 *
 * `ORDER BY slug`: стабильный порядок тиков — чтобы логи одного tick'а
 * читались предсказуемо.
 */
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

// ─── reaper ───────────────────────────────────────────────────────────────────

/**
 * reapStuckRows — reviver для строк, застрявших в `in_flight`.
 *
 * Как строка застревает?  Нормальный путь: lockBatch → processRow → UPDATE
 * статус на sent/failed/dead.  Если между lockBatch и UPDATE процесс упал
 * (OOM, SIGKILL, network partition), строка живёт в `in_flight` навсегда,
 * пока кто-то её не «поднимет».  `processBatch.revival` покрывает только
 * перехваченные в pg-клиенте ошибки; pod crash-loop обходит и её тоже.
 *
 * TTL 30 минут с запасом > session-lock window и максимального row-processing
 * time (канал-адаптер, HTTP timeout и прочее).  Более агрессивный TTL может
 * двойно отправить уведомление (advisory lock не поможет после crash — он
 * сессия-скоуп).  Идемпотентность адаптеров не гарантирована, поэтому режем
 * консервативно.
 */
async function reapStuckRows(db, opts = {}) {
  const { ttlMinutes = DEFAULT_STUCK_TTL_MINUTES } = opts;
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error('reapStuckRows: ttlMinutes must be positive integer');
  }
  const { rowCount } = await db.query(
    `UPDATE notifications_outbox
        SET status = 'pending',
            next_attempt_at = NOW()
      WHERE status = 'in_flight'
        AND last_attempted_at < NOW() - ($1 || ' minutes')::INTERVAL`,
    [String(ttlMinutes)],
  );
  return rowCount | 0;
}

// ─── multi-tenant iteration ───────────────────────────────────────────────────

/**
 * tickAllProperties — один цикл обработки «все active tenants».
 *
 * Per-tenant try/catch: crash одного property (dead pool, missing schema)
 * не должен ронять весь tick.  Логируем и продолжаем.
 *
 * Возвращает массив результатов (для тестов / admin-API).
 */
async function tickAllProperties(args) {
  const {
    platformDb,
    getPool,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
  } = args || {};

  if (typeof getPool !== 'function') {
    throw new Error('tickAllProperties: getPool(property) function required');
  }

  const properties = await listActiveProperties(platformDb);
  const results = [];

  for (const p of properties) {
    try {
      const pool = getPool(p);
      const stats = await worker.runOnce(pool, {
        propertyId: p.id || p.slug,
        batchSize,
        tenant: { id: p.id, slug: p.slug },
      });
      results.push({ slug: p.slug, ...stats });
    } catch (err) {
      logger.error(
        { err: err.message, slug: p.slug },
        '[outbox-runner] tick failed for property',
      );
      results.push({ slug: p.slug, error: err.message });
    }
  }

  return results;
}

/**
 * reapAllProperties — per-tenant reaper на все active properties.
 * Та же схема isolation, что и tickAllProperties.
 */
async function reapAllProperties(args) {
  const {
    platformDb,
    getPool,
    ttlMinutes = DEFAULT_STUCK_TTL_MINUTES,
    logger = defaultLogger,
  } = args || {};

  if (typeof getPool !== 'function') {
    throw new Error('reapAllProperties: getPool(property) function required');
  }

  const properties = await listActiveProperties(platformDb);
  const results = [];

  for (const p of properties) {
    try {
      const pool = getPool(p);
      const reaped = await reapStuckRows(pool, { ttlMinutes });
      if (reaped > 0) {
        logger.info(
          { slug: p.slug, reaped },
          '[outbox-runner] reaped stuck in_flight rows',
        );
      }
      results.push({ slug: p.slug, reaped });
    } catch (err) {
      logger.error(
        { err: err.message, slug: p.slug },
        '[outbox-runner] reap failed for property',
      );
      results.push({ slug: p.slug, error: err.message });
    }
  }

  return results;
}

// ─── runner lifecycle ─────────────────────────────────────────────────────────

/**
 * startOutboxRunner — single public entry.
 *
 * @param {object} opts
 * @param {?object} opts.platformDb          pg pool для platform registry (multi-tenant mode)
 * @param {?Function} opts.getPool           (property) → pg pool; обязателен если есть platformDb
 * @param {?object} opts.fallbackDb          pg pool legacy-tenant (если platformDb отсутствует)
 * @param {?number} opts.intervalMs          tick period (default 30_000)
 * @param {?number} opts.reapIntervalMs      reaper period (default 300_000)
 * @param {?number} opts.stuckTtlMinutes     reaper TTL (default 30)
 * @param {?number} opts.batchSize           batch size per tick (default 50)
 * @param {?object} opts.logger              DI, default: require('../../logger')
 * @returns {{ stop(): void, started: boolean, mode: string, reason?: string }}
 */
function startOutboxRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    reapIntervalMs = DEFAULT_REAP_INTERVAL_MS,
    stuckTtlMinutes = DEFAULT_STUCK_TTL_MINUTES,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
  } = opts;

  // ── gate #1: feature flag ────────────────────────────────────────────
  if (!isOutboxEnabled()) {
    logger.info('[outbox-runner] NOTIFICATIONS_OUTBOX_ENABLED=false — runner not started');
    return { stop() { /* noop */ }, started: false, mode: 'disabled', reason: 'flag_disabled' };
  }

  // ── gate #2: мы должны уметь где-то читать outbox-строки ─────────────
  const hasMultiTenant = Boolean(platformDb && typeof getPool === 'function');
  const hasSingleTenant = Boolean(fallbackDb);

  if (!hasMultiTenant && !hasSingleTenant) {
    logger.warn(
      '[outbox-runner] neither platformDb+getPool nor fallbackDb provided — runner not started',
    );
    return { stop() { /* noop */ }, started: false, mode: 'disabled', reason: 'no_db' };
  }

  // ── single-tenant path (dev / legacy) ───────────────────────────────
  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        await worker.runOnce(fallbackDb, {
          propertyId: DEFAULT_PROPERTY_ID,
          rowPropertyId: null,
          batchSize,
        });
      } catch (err) {
        logger.error({ err: err.message }, '[outbox-runner] single-tenant tick failed');
      }
    };
    const reap = async () => {
      try {
        const reaped = await reapStuckRows(fallbackDb, { ttlMinutes: stuckTtlMinutes });
        if (reaped > 0) {
          logger.info({ reaped }, '[outbox-runner] single-tenant reaped stuck rows');
        }
      } catch (err) {
        logger.error({ err: err.message }, '[outbox-runner] single-tenant reap failed');
      }
    };

    const tickTimer = setInterval(tick, intervalMs);
    if (typeof tickTimer.unref === 'function') tickTimer.unref();
    const reapTimer = setInterval(reap, reapIntervalMs);
    if (typeof reapTimer.unref === 'function') reapTimer.unref();

    logger.info(
      { mode: 'single-tenant', intervalMs, reapIntervalMs, stuckTtlMinutes, batchSize },
      '[outbox-runner] started',
    );

    return {
      started: true,
      mode: 'single-tenant',
      stop() {
        clearInterval(tickTimer);
        clearInterval(reapTimer);
      },
    };
  }

  // ── multi-tenant path (prod) ─────────────────────────────────────────
  const tick = async () => {
    try {
      await tickAllProperties({ platformDb, getPool, batchSize, logger });
    } catch (err) {
      // listActiveProperties rejected (platform DB flakey) — логируем, следующий
      // tick попробует снова.  НЕ останавливаем interval.
      logger.error({ err: err.message }, '[outbox-runner] tick loop caught error');
    }
  };
  const reap = async () => {
    try {
      await reapAllProperties({ platformDb, getPool, ttlMinutes: stuckTtlMinutes, logger });
    } catch (err) {
      logger.error({ err: err.message }, '[outbox-runner] reap loop caught error');
    }
  };

  const tickTimer = setInterval(tick, intervalMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();
  const reapTimer = setInterval(reap, reapIntervalMs);
  if (typeof reapTimer.unref === 'function') reapTimer.unref();

  logger.info(
    { mode: 'multi-tenant', intervalMs, reapIntervalMs, stuckTtlMinutes, batchSize },
    '[outbox-runner] started',
  );

  return {
    started: true,
    mode: 'multi-tenant',
    stop() {
      clearInterval(tickTimer);
      clearInterval(reapTimer);
    },
  };
}

module.exports = {
  startOutboxRunner,
  // exported for tests + admin-API introspection:
  listActiveProperties,
  reapStuckRows,
  tickAllProperties,
  reapAllProperties,
  DEFAULT_INTERVAL_MS,
  DEFAULT_REAP_INTERVAL_MS,
  DEFAULT_STUCK_TTL_MINUTES,
  DEFAULT_BATCH_SIZE,
  DEFAULT_PROPERTY_ID,
};
