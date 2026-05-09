'use strict';

// platform-v1 package SLA runner — Spec: packages-v2-spec.md §5 (SLA + reminders).
//
// The SLA policy is notification-only. It never auto-transitions a package to
// `returned`; return remains a manual staff/admin operation.
//
// One tick runs three idempotent sub-jobs:
//   1. Resident pickup reminder after 7 days.
//   2. Concierge follow-up after 14 days.
//   3. Property-admin alert after 30 days.
//
// Each sub-job is protected by notifications_outbox correlation_id + event_type.
// Multi-tenant lifecycle mirrors the other runners: feature flag, platformDb +
// getPool or single-tenant fallbackDb, per-tenant try/catch, unref interval.

const defaultLogger = require('../../logger');
const {
  enqueueNotificationBatch,
  isOutboxEnabled,
} = require('../services/notificationOutbox');
const packagesService = require('../services/packages');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_REMINDER_AFTER_DAYS = 7;
const DEFAULT_FOLLOWUP_AFTER_DAYS = 14;
const DEFAULT_ADMIN_ALERT_AFTER_DAYS = 30;
const DEFAULT_PROPERTY_ID = 'default';

const PICKUP_REMINDER_EVENT_TYPE = 'package.pickup_reminder';
const FOLLOWUP_EVENT_TYPE = 'package.followup_required';
const ADMIN_ALERT_EVENT_TYPE = 'package.overdue_alert';

const CONCIERGE_FOLLOWUP_ROLES = Object.freeze(['concierge']);
const ADMIN_ALERT_ROLES = Object.freeze(['property_admin']);

// Backward-compatible alias for older callers/tests that passed returnDays.
// It now means "follow-up threshold", not automatic return.
const DEFAULT_AUTO_RETURN_AFTER_DAYS = DEFAULT_FOLLOWUP_AFTER_DAYS;

// ─── registry ───────────────────────────────────────────────────────────────

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

function resolveFollowupDays(opts = {}) {
  return opts.followupDays ?? opts.returnDays ?? DEFAULT_FOLLOWUP_AFTER_DAYS;
}

function validatePositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive number`);
  }
}

// ─── sub-job: 7-day resident reminder ───────────────────────────────────────

async function findRemindCandidates(db, opts = {}) {
  const remindDays = opts.remindDays ?? DEFAULT_REMINDER_AFTER_DAYS;
  const followupDays = resolveFollowupDays(opts);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  validatePositive('findRemindCandidates: remindDays', remindDays);
  if (!Number.isFinite(followupDays) || followupDays <= remindDays) {
    throw new Error('findRemindCandidates: followupDays must be > remindDays');
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
             AND o.event_type = $4
        )
      ORDER BY p.received_at ASC
      LIMIT $3`,
    [String(remindDays), String(followupDays), batchSize, PICKUP_REMINDER_EVENT_TYPE],
  );
  return rows;
}

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

// ─── sub-jobs: 14-day follow-up, 30-day admin alert ─────────────────────────

function packageSelectSql(windowPredicate) {
  return `SELECT p.id,
                 p.property_id,
                 p.unit_id,
                 p.received_at,
                 p.recipient_name_snapshot,
                 p.carrier,
                 p.tracking_number,
                 p.storage_location
            FROM packages_v2 p
           WHERE p.status = 'awaiting_pickup'
             ${windowPredicate}
             AND NOT EXISTS (
               SELECT 1 FROM notifications_outbox o
                WHERE o.correlation_id = p.id
                  AND o.event_type = $4
             )
           ORDER BY p.received_at ASC
           LIMIT $3`;
}

async function findFollowupCandidates(db, opts = {}) {
  const followupDays = resolveFollowupDays(opts);
  const adminAlertDays = opts.adminAlertDays ?? DEFAULT_ADMIN_ALERT_AFTER_DAYS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  validatePositive('findFollowupCandidates: followupDays', followupDays);
  if (!Number.isFinite(adminAlertDays) || adminAlertDays <= followupDays) {
    throw new Error('findFollowupCandidates: adminAlertDays must be > followupDays');
  }

  const { rows } = await db.query(
    packageSelectSql(
      `AND p.received_at < NOW() - ($1 || ' days')::INTERVAL
       AND p.received_at >= NOW() - ($2 || ' days')::INTERVAL`,
    ),
    [String(followupDays), String(adminAlertDays), batchSize, FOLLOWUP_EVENT_TYPE],
  );
  return rows;
}

async function findAdminAlertCandidates(db, opts = {}) {
  const adminAlertDays = opts.adminAlertDays ?? DEFAULT_ADMIN_ALERT_AFTER_DAYS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  validatePositive('findAdminAlertCandidates: adminAlertDays', adminAlertDays);

  const { rows } = await db.query(
    packageSelectSql(
      `AND p.received_at < NOW() - ($1 || ' days')::INTERVAL
       AND $2::text IS NOT NULL`,
    ),
    [String(adminAlertDays), 'admin_alert', batchSize, ADMIN_ALERT_EVENT_TYPE],
  );
  return rows;
}

function buildEscalationPayload(pkg, opts) {
  const receivedAt = pkg.received_at ? new Date(pkg.received_at) : null;
  const daysWaiting = receivedAt && Number.isFinite(receivedAt.getTime())
    ? Math.floor((Date.now() - receivedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    title: opts.title,
    body: opts.body,
    url: opts.url || '/v1/packages',
    package_id: pkg.id,
    unit_id: pkg.unit_id,
    received_at: pkg.received_at,
    days_waiting: daysWaiting,
    recipient_name: pkg.recipient_name_snapshot || null,
    carrier: pkg.carrier || null,
    tracking_number: pkg.tracking_number || null,
    storage_location: pkg.storage_location || null,
  };
}

async function sendStaffEscalations(pool, candidates, opts = {}) {
  const {
    eventType,
    roles,
    title,
    body,
    url,
    logger = defaultLogger,
    enqueueBatchFn = enqueueNotificationBatch,
  } = opts;

  if (!eventType) throw new Error('sendStaffEscalations: eventType required');
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('sendStaffEscalations: roles must be non-empty array');
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const pkg of candidates) {
    let client = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows: staffRows } = await client.query(
        `SELECT id, role
           FROM staff_users
          WHERE property_id = $1
            AND is_active = true
            AND role = ANY($2::text[])
          ORDER BY role, id`,
        [pkg.property_id, roles],
      );

      if (staffRows.length === 0) {
        await client.query('COMMIT');
        skipped += 1;
        continue;
      }

      const basePayload = buildEscalationPayload(pkg, { title, body, url });
      const outboxRows = await enqueueBatchFn(
        client,
        staffRows.map((staff) => ({
          propertyId: pkg.property_id,
          eventType,
          channel: 'web_push',
          recipientType: 'staff',
          recipientId: staff.id,
          payload: {
            ...basePayload,
            recipient_role: staff.role,
          },
          correlationId: pkg.id,
        })),
      );
      await client.query('COMMIT');
      sent += outboxRows.length > 0 ? 1 : 0;
      skipped += outboxRows.length > 0 ? 0 : 1;
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          // Ignore rollback failure; original error is more useful.
        }
      }
      failed += 1;
      logger.warn(
        { err: err.message, packageId: pkg.id, eventType },
        '[package-sla] staff escalation failed for package',
      );
    } finally {
      if (client && typeof client.release === 'function') client.release();
    }
  }

  return { sent, skipped, failed };
}

function combineSkipped(...stats) {
  return stats.reduce((sum, stat) => sum + (stat.skipped || 0), 0);
}

function combineFailed(...stats) {
  return stats.reduce((sum, stat) => sum + (stat.failed || 0), 0);
}

// ─── tick ───────────────────────────────────────────────────────────────────

async function tickSingleTenant(pool, opts = {}) {
  const {
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    adminAlertDays = DEFAULT_ADMIN_ALERT_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    findRemindFn = findRemindCandidates,
    sendRemindersFn = sendReminders,
    findFollowupFn = findFollowupCandidates,
    findAdminAlertFn = findAdminAlertCandidates,
    sendStaffEscalationsFn = sendStaffEscalations,
  } = opts;
  const followupDays = resolveFollowupDays(opts);

  const reminderCandidates = await findRemindFn(pool, { remindDays, followupDays, batchSize });
  const reminderStats = await sendRemindersFn(pool, reminderCandidates, { logger });

  const followupCandidates = await findFollowupFn(pool, {
    followupDays,
    adminAlertDays,
    batchSize,
  });
  const followupStats = await sendStaffEscalationsFn(pool, followupCandidates, {
    eventType: FOLLOWUP_EVENT_TYPE,
    roles: CONCIERGE_FOLLOWUP_ROLES,
    title: 'Просроченная посылка',
    body: `Посылка ожидает выдачи больше ${followupDays} дней. Свяжитесь с получателем или оформите ручной возврат.`,
    logger,
  });

  const adminAlertCandidates = await findAdminAlertFn(pool, { adminAlertDays, batchSize });
  const adminAlertStats = await sendStaffEscalationsFn(pool, adminAlertCandidates, {
    eventType: ADMIN_ALERT_EVENT_TYPE,
    roles: ADMIN_ALERT_ROLES,
    title: 'Критически просроченные посылки',
    body: `Посылка ожидает выдачи больше ${adminAlertDays} дней. Проверьте работу ресепшн-команды.`,
    logger,
  });

  return {
    autoReturned: 0,
    reminded: reminderStats.sent,
    followups: followupStats.sent,
    adminAlerts: adminAlertStats.sent,
    skipped: combineSkipped(reminderStats, followupStats, adminAlertStats),
    failed: combineFailed(reminderStats, followupStats, adminAlertStats),
  };
}

async function tickAllProperties(args) {
  const {
    platformDb,
    getPool,
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    adminAlertDays = DEFAULT_ADMIN_ALERT_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    findRemindFn,
    sendRemindersFn,
    findFollowupFn,
    findAdminAlertFn,
    sendStaffEscalationsFn,
  } = args || {};
  const followupDays = resolveFollowupDays(args || {});

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
        followupDays,
        adminAlertDays,
        batchSize,
        logger,
        findRemindFn,
        sendRemindersFn,
        findFollowupFn,
        findAdminAlertFn,
        sendStaffEscalationsFn,
      });
      if (stats.reminded > 0 || stats.followups > 0 || stats.adminAlerts > 0) {
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

// ─── runner lifecycle ───────────────────────────────────────────────────────

function startPackageSlaRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    remindDays = DEFAULT_REMINDER_AFTER_DAYS,
    adminAlertDays = DEFAULT_ADMIN_ALERT_AFTER_DAYS,
    batchSize = DEFAULT_BATCH_SIZE,
    logger = defaultLogger,
    findRemindFn,
    sendRemindersFn,
    findFollowupFn,
    findAdminAlertFn,
    sendStaffEscalationsFn,
  } = opts;
  const followupDays = resolveFollowupDays(opts);

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

  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        const stats = await tickSingleTenant(fallbackDb, {
          remindDays,
          followupDays,
          adminAlertDays,
          batchSize,
          logger,
          findRemindFn,
          sendRemindersFn,
          findFollowupFn,
          findAdminAlertFn,
          sendStaffEscalationsFn,
        });
        if (stats.reminded > 0 || stats.followups > 0 || stats.adminAlerts > 0) {
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
      {
        mode: 'single-tenant',
        intervalMs,
        remindDays,
        followupDays,
        adminAlertDays,
        batchSize,
      },
      '[package-sla] started',
    );
    return {
      started: true,
      mode: 'single-tenant',
      stop() { clearInterval(tickTimer); },
    };
  }

  const tick = async () => {
    try {
      await tickAllProperties({
        platformDb,
        getPool,
        remindDays,
        followupDays,
        adminAlertDays,
        batchSize,
        logger,
        findRemindFn,
        sendRemindersFn,
        findFollowupFn,
        findAdminAlertFn,
        sendStaffEscalationsFn,
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
    {
      mode: 'multi-tenant',
      intervalMs,
      remindDays,
      followupDays,
      adminAlertDays,
      batchSize,
    },
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
  listActiveProperties,
  findRemindCandidates,
  sendReminders,
  findFollowupCandidates,
  findAdminAlertCandidates,
  buildEscalationPayload,
  sendStaffEscalations,
  tickSingleTenant,
  tickAllProperties,
  DEFAULT_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_REMINDER_AFTER_DAYS,
  DEFAULT_FOLLOWUP_AFTER_DAYS,
  DEFAULT_ADMIN_ALERT_AFTER_DAYS,
  DEFAULT_AUTO_RETURN_AFTER_DAYS,
  DEFAULT_PROPERTY_ID,
  PICKUP_REMINDER_EVENT_TYPE,
  FOLLOWUP_EVENT_TYPE,
  ADMIN_ALERT_EVENT_TYPE,
  CONCIERGE_FOLLOWUP_ROLES,
  ADMIN_ALERT_ROLES,
};
