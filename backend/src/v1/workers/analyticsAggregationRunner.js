'use strict';

// DH-45 analytics aggregation runner.
//
// The live DH-35/DH-36 dashboard services remain the formula source of truth.
// This runner periodically materializes those formulas into
// analytics_kpi_snapshots so exports and management dashboards read a stable
// reporting dataset instead of recalculating every request.

const defaultLogger = require('../../logger');
const { resolveFlags } = require('../../config/featureFlags');
const {
  materializePropertyAnalyticsSnapshot,
} = require('../services/analyticsAggregationService');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_PERIODS = Object.freeze(['24h', '7d', '30d']);
const DEFAULT_PROPERTY_ID = 'default';

function isAnalyticsAggregationEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ANALYTICS_AGGREGATION_ENABLED || ''));
}

function parseFeatureFlags(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

async function listAnalyticsProperties(platformDb) {
  if (!platformDb || typeof platformDb.query !== 'function') {
    throw new Error('listAnalyticsProperties: platformDb with .query required');
  }
  const { rows } = await platformDb.query(
    `SELECT id, slug, db_connection_url, feature_flags, plan
       FROM properties
      WHERE is_active = true
      ORDER BY slug`,
  );

  return rows.filter((row) => {
    const flags = resolveFlags(parseFeatureFlags(row.feature_flags), row.plan || 'core_access');
    return flags.analytics === true;
  });
}

function normalizePeriods(periods) {
  if (periods === undefined || periods === null) return [...DEFAULT_PERIODS];
  const list = Array.isArray(periods) ? periods : String(periods).split(',');
  const normalized = list.map((p) => String(p).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [...DEFAULT_PERIODS];
}

async function tickSingleTenant(pool, opts = {}) {
  const {
    propertyId = DEFAULT_PROPERTY_ID,
    periods = DEFAULT_PERIODS,
    materializeFn = materializePropertyAnalyticsSnapshot,
  } = opts;
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('tickSingleTenant: pool with .query required');
  }

  const snapshots = [];
  for (const period of normalizePeriods(periods)) {
    const result = await materializeFn(pool, {
      propertyId,
      period,
      generatedBy: 'job',
    });
    snapshots.push({
      id: result.snapshot?.id || null,
      period: result.snapshot?.period || period,
      row_count: result.snapshot?.row_count ?? result.metrics?.length ?? 0,
    });
  }
  return snapshots;
}

async function tickAllProperties(args = {}) {
  const {
    platformDb,
    getPool,
    periods = DEFAULT_PERIODS,
    logger = defaultLogger,
    materializeFn = materializePropertyAnalyticsSnapshot,
  } = args;

  if (typeof getPool !== 'function') {
    throw new Error('tickAllProperties: getPool(property) function required');
  }

  const properties = await listAnalyticsProperties(platformDb);
  const results = [];
  for (const property of properties) {
    try {
      const pool = getPool(property);
      const snapshots = await tickSingleTenant(pool, {
        propertyId: property.id || property.slug,
        periods,
        materializeFn,
      });
      results.push({ slug: property.slug, snapshots });
    } catch (err) {
      logger.error(
        { err: err.message, slug: property.slug },
        '[analytics-aggregation] tick failed for property',
      );
      results.push({ slug: property.slug, error: err.message });
    }
  }
  return results;
}

function startAnalyticsAggregationRunner(opts = {}) {
  const {
    platformDb = null,
    getPool = null,
    fallbackDb = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    periods = DEFAULT_PERIODS,
    logger = defaultLogger,
    materializeFn = materializePropertyAnalyticsSnapshot,
  } = opts;

  if (!isAnalyticsAggregationEnabled()) {
    logger.info('[analytics-aggregation] ANALYTICS_AGGREGATION_ENABLED=false - runner not started');
    return { stop() {}, started: false, mode: 'disabled', reason: 'flag_disabled' };
  }

  const hasMultiTenant = Boolean(platformDb && typeof getPool === 'function');
  const hasSingleTenant = Boolean(fallbackDb);
  if (!hasMultiTenant && !hasSingleTenant) {
    logger.warn('[analytics-aggregation] neither platformDb+getPool nor fallbackDb provided - runner not started');
    return { stop() {}, started: false, mode: 'disabled', reason: 'no_db' };
  }

  if (!hasMultiTenant) {
    const tick = async () => {
      try {
        await tickSingleTenant(fallbackDb, {
          propertyId: DEFAULT_PROPERTY_ID,
          periods,
          materializeFn,
        });
      } catch (err) {
        logger.error({ err: err.message }, '[analytics-aggregation] single-tenant tick failed');
      }
    };
    const timer = setInterval(tick, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    logger.info({ mode: 'single-tenant', intervalMs, periods }, '[analytics-aggregation] started');
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
        periods,
        logger,
        materializeFn,
      });
    } catch (err) {
      logger.error({ err: err.message }, '[analytics-aggregation] tick loop caught error');
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ mode: 'multi-tenant', intervalMs, periods }, '[analytics-aggregation] started');
  return {
    started: true,
    mode: 'multi-tenant',
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_PERIODS,
  DEFAULT_PROPERTY_ID,
  isAnalyticsAggregationEnabled,
  listAnalyticsProperties,
  parseFeatureFlags,
  startAnalyticsAggregationRunner,
  tickAllProperties,
  tickSingleTenant,
};
