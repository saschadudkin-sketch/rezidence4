'use strict';

// platform-v1 package SLA runner — Spec: packages-v2-spec.md §5 (SLA + reminders).
//
// Два independent sub-job'а в одном tick'е, чтобы не плодить setInterval'ов:
//
//   1. AUTO-RETURN (14 дней).  Посылки со status='awaiting_pickup' и
//      received_at старше AUTO_RETURN_DAYS возвращаются отправителю автоматом.
//      Один UPDATE с RETURNING — батч-операция, без outbox (резидент уже
//      проигнорировал напоминания).  Счётчик логируем для admin-наблюдения.
//
//   2. REMINDER (7 дней).  Для пачки awaiting_pickup, у которых received_at
//      старше REMINDER_AFTER_DAYS И ещё не было outbox rows с event_type
//      'package.pickup_reminder', вызываем existing remindPackage(pool, id) —
//      он откроет транзакцию и enqueue'нет push+sms по спецификации §5.1.
//
// Порядок важен:
//   AUTO-RETURN идёт ПЕРВЫМ, чтобы посылки > 14 дней перешли в terminal и
//   reminder-джоб не тратил на них tick.  Обратный порядок привёл бы к
//   пуш-нотификации прямо перед авто-возвратом, что выглядит странно.
//
// Идемпотентность:
//   AUTO-RETURN: state machine enforce'ит single-transition (WHERE status =
//     'awaiting_pickup' → один update может сработать только один раз).
//   REMINDER: защищён через NOT EXISTS (outbox row с этим correlation_id +
//     event_type).  Таким образом мы НИКОГДА не пошлём reminder повторно,
//     даже если tick'и пересекутся (повторить можно только через ручной
//     POST /:id/remind — limiter за это отвечает).
//
// Multi-tenant pattern идентичен outboxRunner/scheduledFanoutRunner: gate
// по NOTIFICATIONS_OUTBOX_ENABLED (reminder без outbox'а не доедет),
// platformDb+getPool или fallbackDb, per-tenant try/catch, setInterval с
// .unref(), экспорт helper'ов для тестов.

const defaultLogger = require('../../logger');
const { isOutboxEnabled } = require('../services/notificationOutbox');
const packagesService = require('../services/packages');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;     // 1 hour — не горящая задача
const DEFAULT_BATCH_SIZE = 50;                  // max rows per sub-job per tick
const DEFAULT_REMINDER_AFTER_DAYS = 7;
const DEFAULT_AUTO_RETURN_AFTER_DAYS = 14;
const DEFAULT_PROPERTY_ID = 'default';

const AUTO_RETURN_REASON = 'Автоматически возвращено: посылка не востребована';

// ─── registry ─────────────────────────────────────────────────────────────────

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

// ─── sub-job: auto-return (14 days) ──────────────────────────────────────────

/**
 * autoReturnOverdue — один UPDATE ... RETURNING на все посылки old enough.
 *
 * NB: Не используем packagesService.returnPackage() — он берёт один id за
 * раз и делает SELECT перед UPDATE.  Для батч-операции это лишние round-trip'ы;
 * single UPDATE atomic + state machine check в WHERE сам запретит повторный
 * переход (status уже не 'awaiting_pickup').
 */
async function autoReturnOverdue(db, opts = {}) {
  const days = opts.days ?? DEFAULT_AUTO_RETURN_AFTER_DAYS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('autoReturnOverdue: days must be positive number');
  }

  const reason = `${AUTO_RETURN_REASON} ${days} дней`;

  // Одна atomic UPDATE с subquery для LIMIT (postgres не поддерживает LIMIT
  // в DELETE/UPDATE напрямую).  FOR UPDATE SKIP LOCKED не нужен — параллельный
  // tick не сможет вторично обновить ту же строку (она уже не
  // 'awaiting_pickup'), а lock per-row pg держит сам.
  const { rows } = await db.query(
    `UPDATE packages_v2
        SET status = 'returned',
            returned_at = NOW(),
            returned_reason = $1,
            updated_at = NOW()
      WHERE id IN (
        SELECT id FROM packages_v2
         WHERE status = 'awaiting_pickup'
           AND received_at < NOW() - ($2 || ' days')::INTERVAL
         LIMIT $3
      )
      RETURNING id, property_id, unit_id`,
    [reason, String(days), batchSize],
  );
  return rows;
}

// ─── sub-job: 7-day reminder ─────────────────────────────────────────────────

/**
 * findRemindCandidates — посылки, которым пора отправить reminder.  Окно
 * между REMINDER_AFTER_DAYS и AUTO_RETURN_AFTER_DAYS, чтобы не слать push
 * прямо перед авто-возвратом (auto-return идёт раньше в tick'е, но между
 * tick'ами тоже возможно попадание).
 *
 * Идемпотентность: NOT EXISTS по outbox.correlation_id + event_type
 * 'package.pickup_reminder' (неважно какой status — даже dead row считает
 * как «уже пытались», consistent с ручным POST /:id/remind).
 */
async function findRemindCandidates(db, opts = {}) {
  const remindDays = opts.remindDays ?? DEFAULT_REMINDER_AFTER_DAYS;
  const returnDays = opts.returnDays ?? DEFAULT_AUTO_RETURN_AFTER_DAYS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  if (!Number.isFinite(remindDays) || remindDays <= 0) {
    throw new Error('findRemindCandidates: remindDays must be positive number');
  }
  if (!Number.isFinite(returnDays) || returnDays <= remindDays) {
    throw new Error(
      'findRemindCandidates: returnDays must be > remindDays',
    );
  }

  const { rows } = await db.query(
    `SELECT p.id, p.property_id
       FROM packages_v2 p
      WHERE p.status = 'awaiting_pickup'
        AND p.received_at < NOW() - ($1 || ' days')::INTERVAL
        AND p.received_at >= NOW() - ($2 || ' days')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM notifications_outbox o
           WHERE o.correlation_id = p.id
             AND o.event_type = 'package.pickup_reminder'
        )
      ORDER BY p.received_at ASC
      LIMIT $3`,
    [String(remindDays), String(returnDays), batchSize],
  );
  return rows;
}

/**
 * sendReminders — итерирует кандидатов и вызывает remindPackage (сам
 * открывает транзакцию, enqueue'ит outbox rows).  Per-package try/catch:
 * одна плохая посылка не должна ронять batch.
 */
async function sendReminders(pool, candidates, opts = {}) {
  const {
    logger = defaultLogger,
    remindFn = packagesService.remindPackage,
  } = opts;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const pkg of candidates) {
    try {
      const { conflict, outboxRows } = await remindFn(pool, pkg.id);
      if (conflict) {
        skipped += 1;
      } else {
        sent += (outboxRows?.length || 0) > 0 ? 1 : 0;
      }
    } catch (err) {
      failed += 1;
      logger.warn(
        { err: err.message, packageId: pkg.id },
        '[package-sla] remind failed for package',
      );
    }
  }
  return { sent, skipped, failed };
}

// ─── tick ────────────────────────────────────────────────────────────────────

/**
 * tickSingleTenant — обработка одного pool'а.  Экспортирован отдельно, чтобы
 * тесты подменяли только этот кусок и не трогали интервал.
 *
 * Возвращает сводку { autoReturned, reminded, skipped, failed } — полезно
 * в логах и для admin-API «sla health».
 */
async function tickSingleTenant(pool, opts = {}) {
  const {
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    returnDays = DEFAULT_AUTO_RETURN_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    autoReturnFn = autoReturnOverdue,
    findRemindFn = findRemindCandidates,
    sendRemindersFn = sendReminders,
  } = opts;

  // 1. Auto-return первым — убираем из awaiting перед reminder-ом.
  const autoReturned = await autoReturnFn(pool, { days: returnDays, batchSize });

  // 2. Reminder по оставшимся.
  const candidates = await findRemindFn(pool, { remindDays, returnDays, batchSize });
  const reminderStats = await sendRemindersFn(pool, candidates, { logger });

  return {
    autoReturned: autoReturned.length,
    reminded: reminderStats.sent,
    skipped: reminderStats.skipped,
    failed: reminderStats.failed,
  };
}

/**
 * tickAllProperties — обход всех active tenants.  Per-tenant try/catch.
 */
async function tickAllProperties(args) {
  const {
    platformDb,
    getPool,
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    returnDays = DEFAULT_AUTO_RETURN_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    autoReturnFn,
    findRemindFn,
    sendRemindersFn,
  } = args || {};

  if (typeof getPool !== 'function') {
    throw new Error('tickAllProperties: getPool(property) function required');
  }

  const properties = await listActiveProperties(platformDb);
  const results = [];

  for (const p of properties) {
    try {
      const pool = getPool(p);
      const stats = await tickSingleTenant(pool, {
        remindDays,
        returnDays,
        batchSize,
        logger,
        autoReturnFn,
        findRemindFn,
        sendRemindersFn,
      });
      if (stats.autoReturned > 0 || stats.reminded > 0) {
        logger.info(
          { slug: p.slug, ...stats },
          '[package-sla] tick processed',
        );
      }
      results.push({ slug: p.slug, ...stats });
    } catch (err) {
      logger.error(
        { err: err.message, slug: p.slug },
        '[package-sla] tick failed for property',
      );
      results.push({ slug: p.slug, error: err.message });
    }
  }
  return results;
}

// ─── runner lifecycle ─────────────────────────────────────────────────────────

/**
 * startPackageSlaRunner — единственная публичная точка запуска.
 *
 * @param {object} opts
 * @param {?object}   opts.platformDb     pg pool для platform registry
 * @param {?Function} opts.getPool        (property) → pg pool; нужен если platformDb
 * @param {?object}   opts.fallbackDb     pg pool tenant'а (single-tenant dev)
 * @param {?number}   opts.intervalMs     tick period (default 1h)
 * @param {?number}   opts.remindDays     дни до reminder (default 7)
 * @param {?number}   opts.returnDays     дни до auto-return (default 14)
 * @param {?number}   opts.batchSize      max rows per sub-job (default 50)
 * @param {?object}   opts.logger         DI
 * @returns {{ stop(): void, started: boolean, mode: string, reason?: string }}
 */
function startPackageSlaRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    returnDays = DEFAULT_AUTO_RETURN_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    autoReturnFn,
    findRemindFn,
    sendRemindersFn,
  } = opts;

  // gate #1: outbox выключен → reminder не доедет, смысла крутить цикл нет
  if (!isOutboxEnabled()) {
    logger.info(
      '[package-sla] NOTIFICATIONS_OUTBOX_ENABLED=false — runner not started',
    );
    return {
      stop() { /* noop */ },
      started: false,
      mode: 'disabled',
      reason: 'flag_disabled',
    };
  }

  // gate #2: хоть какой-то источник БД
  const hasMultiTenant = Boolean(platformDb && typeof getPool === 'function');
  const hasSingleTenant = Boolean(fallbackDb);
  if (!hasMultiTenant && !hasSingleTenant) {
    logger.warn(
      '[package-sla] neither platformDb+getPool nor fallbackDb provided — runner not started',
    );
    return {
      stop() { /* noop */ },
      started: false,
      mode: 'disabled',
      reason: 'no_db',
    };
  }

  // ── single-tenant (dev) ────────────────────────────────────────────────
  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        const stats = await tickSingleTenant(fallbackDb, {
          remindDays,
          returnDays,
          batchSize,
          logger,
          autoReturnFn,
          findRemindFn,
          sendRemindersFn,
        });
        if (stats.autoReturned > 0 || stats.reminded > 0) {
          logger.info(
            { property: DEFAULT_PROPERTY_ID, ...stats },
            '[package-sla] single-tenant tick processed',
          );
        }
      } catch (err) {
        logger.error(
          { err: err.message },
          '[package-sla] single-tenant tick failed',
        );
      }
    };
    const tickTimer = setInterval(tick, intervalMs);
    if (typeof tickTimer.unref === 'function') tickTimer.unref();

    logger.info(
      { mode: 'single-tenant', intervalMs, remindDays, returnDays, batchSize },
      '[package-sla] started',
    );
    return {
      started: true,
      mode: 'single-tenant',
      stop() { clearInterval(tickTimer); },
    };
  }

  // ── multi-tenant (prod) ────────────────────────────────────────────────
  const tick = async () => {
    try {
      await tickAllProperties({
        platformDb,
        getPool,
        remindDays,
        returnDays,
        batchSize,
        logger,
        autoReturnFn,
        findRemindFn,
        sendRemindersFn,
      });
    } catch (err) {
      logger.error(
        { err: err.message },
        '[package-sla] tick loop caught error',
      );
    }
  };
  const tickTimer = setInterval(tick, intervalMs);
  if (typeof tickTimer.unref === 'function') tickTimer.unref();

  logger.info(
    { mode: 'multi-tenant', intervalMs, remindDays, returnDays, batchSize },
    '[package-sla] started',
  );
  return {
    started: true,
    mode: 'multi-tenant',
    stop() { clearInterval(tickTimer); },
  };
}

module.exports = {
  startPackageSlaRunner,
  // exported for tests + admin introspection:
  listActiveProperties,
  autoReturnOverdue,
  findRemindCandidates,
  sendReminders,
  tickSingleTenant,
  tickAllProperties,
  DEFAULT_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_AUTO_RETURN_AFTER_DAYS,
  DEFAULT_PROPERTY_ID,
  AUTO_RETURN_REASON,
};
