'use strict';

const logger = require('../logger');
const { broadcastRequestUpdate } = require('../sse');

function startRuntimeJobs({ db }) {
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

  return {
    stop() {
      clearInterval(cleanupJob);
      clearInterval(expirationJob);
      clearInterval(otpCleanupTimer);
    },
  };
}

module.exports = {
  startRuntimeJobs,
};
