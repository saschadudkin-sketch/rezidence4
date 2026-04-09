'use strict';

const logger = require('../logger');

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
      const { rowCount: expired } = await db.query(`
        UPDATE requests
        SET status = 'expired', updated_at = NOW()
        WHERE status IN ('pending', 'approved')
          AND deleted_at IS NULL
          AND (
            (pass_duration = 'once'
             AND created_at < NOW() - INTERVAL '24 hours')
            OR
            (valid_until IS NOT NULL AND valid_until < NOW())
          )
      `);

      const { rowCount: activated } = await db.query(`
        UPDATE requests
        SET status = 'pending', scheduled_for = NULL, updated_at = NOW()
        WHERE status = 'scheduled'
          AND scheduled_for <= NOW()
          AND deleted_at IS NULL
      `);

      if (expired > 0) logger.info(`[expiration] expired ${expired} requests`);
      if (activated > 0) logger.info(`[expiration] activated ${activated} scheduled requests`);
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
