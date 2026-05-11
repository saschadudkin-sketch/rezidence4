'use strict';

// DH-60 sensitive-action review runner.
//
// One tick does two deterministic maintenance steps per tenant:
// 1. Materialize sampled sensitive audit rows into sensitive_action_reviews.
// 2. Escalate pending review rows whose due_at breached.

const defaultLogger = require('../../logger');
const {
  escalateOverdueSensitiveActionReviews,
  materializeSensitiveActionReviewSamples,
} = require('../services/auditReviewService');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_WINDOW_HOURS = 168;
const DEFAULT_SAMPLE_PERCENT = 10;
const DEFAULT_DUE_HOURS = 72;
const DEFAULT_ESCALATE_AFTER_HOURS = 24;
const DEFAULT_PROPERTY_ID = 'default';

function isSensitiveReviewRunnerEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.SENSITIVE_REVIEW_RUNNER_ENABLED || ''));
}

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

function countEscalations(rows, status) {
  return rows.filter((row) => row.escalation_status === status).length;
}

async function tickSingleTenant(pool, opts = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('tickSingleTenant: pool with .query required');
  }

  const {
    propertyId = null,
    batchSize = DEFAULT_BATCH_SIZE,
    windowHours = DEFAULT_WINDOW_HOURS,
    samplePercent = DEFAULT_SAMPLE_PERCENT,
    dueHours = DEFAULT_DUE_HOURS,
    escalateAfterHours = DEFAULT_ESCALATE_AFTER_HOURS,
    materializeFn = materializeSensitiveActionReviewSamples,
    escalateFn = escalateOverdueSensitiveActionReviews,
  } = opts;

  const filters = {};
  if (propertyId && propertyId !== DEFAULT_PROPERTY_ID) filters.property_id = propertyId;

  const sampled = await materializeFn({
    queryable: pool,
    filters,
    options: {
      limit: batchSize,
      windowHours,
      samplePercent,
      dueHours,
    },
  });

  const escalated = await escalateFn({
    queryable: pool,
    filters,
    options: {
      limit: batchSize,
      escalateAfterHours,
    },
  });

  return {
    sampled: sampled.length,
    overdue: countEscalations(escalated, 'overdue'),
    escalated: countEscalations(escalated, 'escalated'),
  };
}

async function tickAllProperties(args = {}) {
  const {
    platformDb,
    getPool,
    logger = defaultLogger,
    batchSize = DEFAULT_BATCH_SIZE,
    windowHours = DEFAULT_WINDOW_HOURS,
    samplePercent = DEFAULT_SAMPLE_PERCENT,
    dueHours = DEFAULT_DUE_HOURS,
    escalateAfterHours = DEFAULT_ESCALATE_AFTER_HOURS,
    materializeFn,
    escalateFn,
  } = args;

  if (typeof getPool !== 'function') {
    throw new Error('tickAllProperties: getPool(property) function required');
  }

  const properties = await listActiveProperties(platformDb);
  const results = [];
  for (const property of properties) {
    try {
      const pool = getPool(property);
      const stats = await tickSingleTenant(pool, {
        propertyId: property.id || property.slug,
        batchSize,
        windowHours,
        samplePercent,
        dueHours,
        escalateAfterHours,
        materializeFn,
        escalateFn,
      });
      if (stats.sampled > 0 || stats.overdue > 0 || stats.escalated > 0) {
        logger.info({ slug: property.slug, ...stats }, '[sensitive-review] tick processed');
      }
      results.push({ slug: property.slug, ...stats });
    } catch (err) {
      logger.error(
        { err: err.message, slug: property.slug },
        '[sensitive-review] tick failed for property',
      );
      results.push({ slug: property.slug, error: err.message });
    }
  }
  return results;
}

function startSensitiveReviewRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    windowHours = DEFAULT_WINDOW_HOURS,
    samplePercent = DEFAULT_SAMPLE_PERCENT,
    dueHours = DEFAULT_DUE_HOURS,
    escalateAfterHours = DEFAULT_ESCALATE_AFTER_HOURS,
    logger = defaultLogger,
    materializeFn,
    escalateFn,
  } = opts;

  if (!isSensitiveReviewRunnerEnabled()) {
    logger.info('[sensitive-review] SENSITIVE_REVIEW_RUNNER_ENABLED=false - runner not started');
    return { stop() {}, started: false, mode: 'disabled', reason: 'flag_disabled' };
  }

  const hasMultiTenant = Boolean(platformDb && typeof getPool === 'function');
  const hasSingleTenant = Boolean(fallbackDb);
  if (!hasMultiTenant && !hasSingleTenant) {
    logger.warn('[sensitive-review] neither platformDb+getPool nor fallbackDb provided - runner not started');
    return { stop() {}, started: false, mode: 'disabled', reason: 'no_db' };
  }

  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        const stats = await tickSingleTenant(fallbackDb, {
          propertyId: DEFAULT_PROPERTY_ID,
          batchSize,
          windowHours,
          samplePercent,
          dueHours,
          escalateAfterHours,
          materializeFn,
          escalateFn,
        });
        if (stats.sampled > 0 || stats.overdue > 0 || stats.escalated > 0) {
          logger.info({ property: DEFAULT_PROPERTY_ID, ...stats }, '[sensitive-review] single-tenant tick processed');
        }
      } catch (err) {
        logger.error({ err: err.message }, '[sensitive-review] single-tenant tick failed');
      }
    };

    const timer = setInterval(tick, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    logger.info({ mode: 'single-tenant', intervalMs, batchSize }, '[sensitive-review] started');
    return {
      started: true,
      mode: 'single-tenant',
      stop() {
        clearInterval(timer);
      },
    };
  }

  const tick = async () => {
    try {
      await tickAllProperties({
        platformDb,
        getPool,
        logger,
        batchSize,
        windowHours,
        samplePercent,
        dueHours,
        escalateAfterHours,
        materializeFn,
        escalateFn,
      });
    } catch (err) {
      logger.error({ err: err.message }, '[sensitive-review] tick loop caught error');
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ mode: 'multi-tenant', intervalMs, batchSize }, '[sensitive-review] started');
  return {
    started: true,
    mode: 'multi-tenant',
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_DUE_HOURS,
  DEFAULT_ESCALATE_AFTER_HOURS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_PROPERTY_ID,
  DEFAULT_SAMPLE_PERCENT,
  DEFAULT_WINDOW_HOURS,
  isSensitiveReviewRunnerEnabled,
  listActiveProperties,
  startSensitiveReviewRunner,
  tickAllProperties,
  tickSingleTenant,
};
