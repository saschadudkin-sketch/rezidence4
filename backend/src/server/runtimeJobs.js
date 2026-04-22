'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { broadcastRequestUpdate } = require('../sse');
const { dispatch: notifyDispatch } = require('../services/notificationService');
const webhookService = require('../services/webhookService');

// ─── photoRetentionSweep (ФЗ-152) ─────────────────────────────────────────────
// Deletes upload_objects older than PHOTO_RETENTION_DAYS (default 365) along
// with their backing files on disk.  The sweep runs in batches of 100 per tick
// to keep DB pressure low.  Errors are swallowed — the job must never stop the
// interval timer.
const PHOTO_RETENTION_DAYS = Number(process.env.PHOTO_RETENTION_DAYS || 365);
const PHOTO_RETENTION_BATCH = 100;

async function photoRetentionSweep(db, property) {
  if (!Number.isFinite(PHOTO_RETENTION_DAYS) || PHOTO_RETENTION_DAYS <= 0) return;
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
  try {
    const { rows } = await db.query(
      `SELECT filename
         FROM upload_objects
         WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
         LIMIT $2`,
      [String(PHOTO_RETENTION_DAYS), PHOTO_RETENTION_BATCH],
    );
    if (rows.length === 0) return;

    let removed = 0;
    for (const { filename } of rows) {
      // Defence in depth — never let a rogue filename escape uploadDir.
      const safeName = path.basename(String(filename || ''));
      if (!safeName) continue;
      const abs = path.join(uploadDir, safeName);
      try {
        await fs.promises.unlink(abs);
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          logger.warn({ err, filename: safeName }, '[photo-retention] unlink failed');
        }
      }
      await db.query(
        `DELETE FROM upload_objects WHERE filename = $1`,
        [safeName],
      ).catch(() => { /* keep sweeping */ });
      removed += 1;
    }

    if (removed > 0) {
      logger.info(
        { removed, retentionDays: PHOTO_RETENTION_DAYS, property: property?.slug },
        '[photo-retention] expired uploads removed',
      );
    }
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[photo-retention] sweep failed');
  }
}

// ─── checkBillingOverdue ──────────────────────────────────────────────────────
// Marks pending billing_records as 'overdue' when their due_date has passed,
// then dispatches a 'billing.overdue' notification for each affected record.
async function checkBillingOverdue(db, property) {
  try {
    const { rows } = await db.query(`
      UPDATE billing_records
      SET status = 'overdue', updated_at = NOW()
      WHERE status = 'pending' AND due_date < CURRENT_DATE
      RETURNING id, user_id, apartment, amount, period_year, period_month
    `);
    if (rows.length === 0) return;
    logger.info({ count: rows.length, property: property?.slug }, '[billing-overdue] marked overdue');
    for (const record of rows) {
      notifyDispatch(
        'billing.overdue',
        {
          userId:       record.user_id,
          recordId:     record.id,
          apartment:    record.apartment,
          amount:       record.amount,
          period_year:  record.period_year,
          period_month: record.period_month,
        },
        db,
        property || null,
      ).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[billing-overdue] job failed');
  }
}

// ─── sendMeterReminders ───────────────────────────────────────────────────────
// Runs only on the 25th of each month.
// Dispatches a 'meter.reminder' notification to every active resident
// (users with role 'owner' or 'tenant' who have not been deleted).
async function sendMeterReminders(db, property) {
  const today = new Date();
  if (today.getDate() !== 25) return;

  try {
    const { rows: residents } = await db.query(`
      SELECT uid
      FROM users
      WHERE role IN ('owner', 'tenant')
        AND deleted_at IS NULL
    `);
    if (residents.length === 0) return;
    logger.info({ count: residents.length, property: property?.slug }, '[meter-reminder] dispatching reminders');
    for (const resident of residents) {
      notifyDispatch(
        'meter.reminder',
        { userId: resident.uid },
        db,
        property || null,
      ).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[meter-reminder] job failed');
  }
}

// ─── checkSlaOverdue ─────────────────────────────────────────────────────────
// Finds requests that have exceeded their SLA and notifies staff/admin once.
// Inserts a 'sla_overdue_notified' marker into request_history to prevent
// repeated notifications.
async function checkSlaOverdue(db, property) {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.type, r.created_by_uid, r.created_at, s.sla_hours
      FROM requests r
      JOIN request_sla_config s ON s.request_type = r.type AND s.is_active = true
      WHERE r.status IN ('pending', 'approved')
        AND r.deleted_at IS NULL
        AND r.created_at + (s.sla_hours || ' hours')::INTERVAL < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM request_history h
          WHERE h.req_id = r.id AND h.label = 'sla_overdue_notified'
        )
      LIMIT 50
    `);

    if (rows.length === 0) return;
    logger.info({ count: rows.length, property: property?.slug }, '[sla-overdue] processing overdue requests');

    for (const req of rows) {
      // Insert history marker so we don't re-notify
      await db.query(
        `INSERT INTO request_history (req_id, by_name, by_role, label)
         VALUES ($1, 'system', 'system', 'sla_overdue_notified')`,
        [req.id],
      ).catch(() => {});

      notifyDispatch('request.sla_overdue', {
        requestId:   req.id,
        requestType: req.type,
        slaHours:    req.sla_hours,
      }, db, property).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[sla-overdue] job failed');
  }
}

// ─── sendPackageReminders ─────────────────────────────────────────────────────
// Runs every hour but only dispatches during the 18:00 window.
// Finds packages awaiting pickup for more than 2 days without a recent reminder.
async function sendPackageReminders(db, property) {
  const hour = new Date().getHours();
  if (hour !== 18) return;

  try {
    const { rows } = await db.query(`
      SELECT p.*, u.uid AS user_uid
      FROM packages p
      LEFT JOIN users u ON u.apartment = p.recipient_apartment AND u.deleted_at IS NULL
      WHERE p.status = 'awaiting_pickup'
        AND p.received_at < NOW() - INTERVAL '2 days'
        AND (p.reminder_sent_at IS NULL OR p.reminder_sent_at < NOW() - INTERVAL '20 hours')
      LIMIT 20
    `);

    if (rows.length === 0) return;
    logger.info({ count: rows.length, property: property?.slug }, '[pkg-reminder] sending reminders');

    for (const pkg of rows) {
      if (pkg.user_uid) {
        notifyDispatch('package.reminder', {
          userId:     pkg.user_uid,
          packageId:  pkg.id,
          receivedAt: pkg.received_at,
        }, db, property).catch(() => {});
      }
      await db.query(
        `UPDATE packages SET reminder_sent_at = NOW() WHERE id = $1`,
        [pkg.id],
      ).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[pkg-reminder] job failed');
  }
}

// ─── processWebhooks ─────────────────────────────────────────────────────────
// Process pending/retrying webhook deliveries.  Runs every 30 seconds per
// property.  Failures are swallowed so the interval never stops.
async function processWebhooks(db, property) {
  try {
    await webhookService.processPendingDeliveries(db);
  } catch (err) {
    logger.error({ err, property: property?.slug }, '[webhooks] processWebhooks job failed');
  }
}

function startRuntimeJobs({ db, property }) {
  const cleanupJob = setInterval(async () => {
    try {
      const { rowCount } = await db.query(
        'DELETE FROM token_revocations WHERE expires_at < NOW()'
      );
      if (rowCount > 0) logger.info(`[cleanup] removed ${rowCount} expired token revocations`);
    } catch (err) {
      logger.error({ err }, '[cleanup] token_revocations failed');
    }
  }, 60 * 60 * 1000);
  cleanupJob.unref();

  const expirationJob = setInterval(async () => {
    try {
      // FIX [BUG]: добавлен SSE broadcast при изменении статуса через фоновый джоб.
      // Без broadcast охрана и консьерж не узнают об истечении/активации заявок
      // до следующего переподключения SSE или перезагрузки страницы.
      // RETURNING позволяет broadcast только изменённых строк — не перегружаем SSE.
      const { rows: expiredRows } = await db.query(`
        WITH expired_candidates AS (
          SELECT id
          FROM requests
          WHERE status IN ('pending', 'approved')
            AND deleted_at IS NULL
            AND (
              (pass_duration = 'once'
               AND created_at < NOW() - INTERVAL '24 hours')
              OR
              (valid_until IS NOT NULL AND valid_until < NOW())
            )
          FOR UPDATE SKIP LOCKED
        )
        UPDATE requests
        SET status = 'expired', updated_at = NOW()
        FROM expired_candidates
        WHERE requests.id = expired_candidates.id
          AND requests.status IN ('pending', 'approved')
        RETURNING id, type, category, status, created_by_uid,
          created_by_name, created_by_role, created_by_apt,
          visitor_name, visitor_phone, car_plate, comment,
          pass_duration, valid_until, scheduled_for, arrived_at,
          photos, created_at, updated_at
      `);

      const { rows: activatedRows } = await db.query(`
        WITH scheduled_candidates AS (
          SELECT id
          FROM requests
          WHERE status = 'scheduled'
            AND scheduled_for <= NOW()
            AND deleted_at IS NULL
          FOR UPDATE SKIP LOCKED
        )
        UPDATE requests
        SET status = CASE
              WHEN type = 'pass' THEN 'approved'
              ELSE 'pending'
            END,
            scheduled_for = NULL,
            updated_at = NOW()
        FROM scheduled_candidates
        WHERE requests.id = scheduled_candidates.id
          AND requests.status = 'scheduled'
        RETURNING id, type, category, status, created_by_uid,
          created_by_name, created_by_role, created_by_apt,
          visitor_name, visitor_phone, car_plate, comment,
          pass_duration, valid_until, scheduled_for, arrived_at,
          photos, created_at, updated_at
      `);

      if (expiredRows.length > 0) {
        logger.info(`[expiration] expired ${expiredRows.length} requests`);
        expiredRows.forEach(r => {
          try { broadcastRequestUpdate(r); } catch { /* SSE не должна ронять джоб */ }
        });
      }
      if (activatedRows.length > 0) {
        logger.info(`[expiration] activated ${activatedRows.length} scheduled requests`);
        activatedRows.forEach(r => {
          try { broadcastRequestUpdate(r); } catch { /* SSE не должна ронять джоб */ }
        });
      }
    } catch (err) {
      logger.error({ err }, '[expiration] request status update failed');
    }
  }, 5 * 60 * 1000);
  expirationJob.unref();

  const otpCleanupInterval = 5 * 60 * 1000;
  const runOtpCleanup = async () => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 hour'`
      );
      if (rowCount > 0) logger.info({ rowCount }, '[otp-cleanup] deleted expired codes');
    } catch (err) {
      logger.warn({ err }, '[otp-cleanup] failed');
    }
  };
  runOtpCleanup();
  const otpCleanupTimer = setInterval(runOtpCleanup, otpCleanupInterval);
  otpCleanupTimer.unref();

  // Billing overdue: runs every hour (also triggered on startup to catch overnight records).
  const runBillingOverdue = () => checkBillingOverdue(db, property);
  runBillingOverdue();
  const billingOverdueTimer = setInterval(runBillingOverdue, 60 * 60 * 1000);
  billingOverdueTimer.unref();

  // Meter reminders: checked every hour; the function itself gates on day-of-month === 25.
  const runMeterReminders = () => sendMeterReminders(db, property);
  runMeterReminders();
  const meterReminderTimer = setInterval(runMeterReminders, 60 * 60 * 1000);
  meterReminderTimer.unref();

  // SLA overdue: runs every 15 minutes.
  const runSlaOverdue = () => checkSlaOverdue(db, property);
  const slaOverdueTimer = setInterval(runSlaOverdue, 15 * 60 * 1000);
  slaOverdueTimer.unref();

  // Package reminders: checked every hour; the function itself gates on hour === 18.
  const runPackageReminders = () => sendPackageReminders(db, property);
  runPackageReminders();
  const packageReminderTimer = setInterval(runPackageReminders, 60 * 60 * 1000);
  packageReminderTimer.unref();

  // Webhook deliveries: process pending/retrying rows every 30 seconds.
  const runProcessWebhooks = () => processWebhooks(db, property);
  const webhookDeliveryTimer = setInterval(runProcessWebhooks, 30 * 1000);
  webhookDeliveryTimer.unref();

  // Photo retention (ФЗ-152): sweeps expired upload_objects hourly.  The sweep
  // processes PHOTO_RETENTION_BATCH rows per tick so a large backlog drains
  // over several ticks without monopolising the event loop.
  const runPhotoRetention = () => photoRetentionSweep(db, property);
  const photoRetentionTimer = setInterval(runPhotoRetention, 60 * 60 * 1000);
  photoRetentionTimer.unref();

  return {
    stop() {
      clearInterval(cleanupJob);
      clearInterval(expirationJob);
      clearInterval(otpCleanupTimer);
      clearInterval(billingOverdueTimer);
      clearInterval(meterReminderTimer);
      clearInterval(slaOverdueTimer);
      clearInterval(packageReminderTimer);
      clearInterval(webhookDeliveryTimer);
      clearInterval(photoRetentionTimer);
    },
  };
}

module.exports = {
  startRuntimeJobs,
  checkBillingOverdue,
  sendMeterReminders,
  checkSlaOverdue,
  sendPackageReminders,
  processWebhooks,
  photoRetentionSweep,
};
