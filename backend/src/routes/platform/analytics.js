'use strict';

/**
 * routes/platform/analytics.js — Phase 6 Platform Analytics (superadmin).
 *
 * Aggregates summary counts from each active property's own database.
 * No PII crosses property boundaries — counts only.
 *
 * GET /platform/api/v1/analytics/overview
 *   Returns per-property active users, visit counts, request counts for
 *   the last 30 days, plus platform-level totals.
 */

const express      = require('express');
const { Pool }     = require('pg');
const { getPlatformDb } = require('../../db');
const platformAuth = require('../../middleware/platformAuth');
const logger       = require('../../logger');

const router = express.Router();
router.use(platformAuth);

// Pool cache for per-property connections (keyed by db_connection_url)
const _pools = new Map();

function getPropertyPool(dbUrl) {
  if (!_pools.has(dbUrl)) {
    const pool = new Pool({
      connectionString:        dbUrl,
      max:                      5,   // analytics — smaller pool is fine
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis:  5_000,
      statement_timeout:       10_000,
    });
    pool.on('error', (err) =>
      logger.warn({ err }, '[platform/analytics] property pool error'),
    );
    _pools.set(dbUrl, pool);
  }
  return _pools.get(dbUrl);
}

/**
 * Query a single property DB for 30-day summary stats.
 * Returns { active_users, visits_30d, requests_30d, health }.
 * On any error returns zeroed counts and health='error'.
 */
async function queryPropertyStats(property) {
  const { slug, db_connection_url } = property;

  if (!db_connection_url) {
    logger.warn({ slug }, '[platform/analytics] property has no db_connection_url');
    return { active_users: 0, visits_30d: 0, requests_30d: 0, health: 'error' };
  }

  try {
    const pool = getPropertyPool(db_connection_url);

    const [usersResult, visitsResult, requestsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT uid) AS active_users
         FROM users
         WHERE (last_active_at > NOW() - INTERVAL '30 days'
             OR created_at      > NOW() - INTERVAL '30 days')
           AND deleted_at IS NULL`,
      ),
      pool.query(
        `SELECT COUNT(*) AS visits_30d
         FROM visit_logs
         WHERE timestamp > NOW() - INTERVAL '30 days'`,
      ),
      pool.query(
        `SELECT COUNT(*) AS requests_30d
         FROM requests
         WHERE created_at > NOW() - INTERVAL '30 days'
           AND deleted_at IS NULL`,
      ),
    ]);

    return {
      active_users:  Number(usersResult.rows[0]?.active_users  || 0),
      visits_30d:    Number(visitsResult.rows[0]?.visits_30d    || 0),
      requests_30d:  Number(requestsResult.rows[0]?.requests_30d || 0),
      health: 'ok',
    };
  } catch (err) {
    logger.warn({ err, slug }, '[platform/analytics] failed to query property stats');
    return { active_users: 0, visits_30d: 0, requests_30d: 0, health: 'error' };
  }
}

// ─── GET /platform/api/v1/analytics/overview ─────────────────────────────────

router.get('/overview', async (req, res, next) => {
  try {
    const platformDb = getPlatformDb();

    // Fetch all active properties
    const { rows: properties } = await platformDb.query(
      `SELECT slug, name, db_connection_url
       FROM properties
       WHERE is_active = true
       ORDER BY name`,
    );

    // Query each property concurrently; failures are isolated per-property
    const statsPerProperty = await Promise.all(
      properties.map(async (prop) => {
        const stats = await queryPropertyStats(prop);
        return {
          slug:         prop.slug,
          name:         prop.name,
          active_users: stats.active_users,
          visits_30d:   stats.visits_30d,
          requests_30d: stats.requests_30d,
          health:       stats.health,
        };
      }),
    );

    const totals = {
      properties: statsPerProperty.length,
      visits_30d: statsPerProperty.reduce((sum, p) => sum + p.visits_30d, 0),
    };

    return res.json({ properties: statsPerProperty, totals });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
