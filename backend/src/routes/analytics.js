'use strict';

/**
 * routes/analytics.js — Phase 6 Analytics endpoints (admin-only).
 *
 * All endpoints:
 *  - Require admin role (enforced here, router is also mounted under requireAuth in registerApiRoutes)
 *  - Support ?format=csv for CSV download
 *  - Cache results in Redis (TTL 300s for real-time, 3600s for daily aggregates)
 *  - Use parameterised SQL against req.db (property-specific pool)
 */

const express     = require('express');
const crypto      = require('crypto');
const requireAuth = require('../middleware/auth');
const { getRedis } = require('../lib/redisClient');
const logger      = require('../logger');

const router = express.Router();
router.use(requireAuth);

// ─── Admin guard ─────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

router.use(requireAdmin);

// ─── Input validation ─────────────────────────────────────────────────────────

function parseDateRange(query) {
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to   = query.to   ? new Date(query.to)   : new Date();

  if (isNaN(from) || isNaN(to)) {
    throw { status: 400, code: 'INVALID_DATE', message: 'Invalid date format' };
  }
  if (from > to) {
    throw { status: 400, code: 'INVALID_RANGE', message: 'from must be before or equal to to' };
  }
  if (to - from > 366 * 24 * 60 * 60 * 1000) {
    throw { status: 400, code: 'RANGE_TOO_LARGE', message: 'Max range is 1 year' };
  }
  return { from, to };
}

function parseGranularity(value) {
  if (value === undefined || value === null || value === '') return 'day';
  const granularity = String(value).trim().toLowerCase();
  if (!['hour', 'day'].includes(granularity)) {
    throw { status: 400, code: 'INVALID_GRANULARITY', message: 'granularity must be hour or day' };
  }
  return granularity;
}

// ─── Redis caching ────────────────────────────────────────────────────────────

async function cachedQuery(redis, cacheKey, ttl, queryFn) {
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      logger.warn({ err, cacheKey }, '[analytics] Redis get failed, proceeding without cache');
    }
  }

  const result = await queryFn();

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', ttl);
    } catch (err) {
      logger.warn({ err, cacheKey }, '[analytics] Redis set failed');
    }
  }

  return result;
}

function makeParamsHash(params) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 12);
}

function buildCacheKey(propertySlug, endpoint, params) {
  return `analytics:${propertySlug || 'default'}:${endpoint}:${makeParamsHash(params)}`;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function toCSV(headers, rows) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

function sendCSV(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCSV(headers, rows));
}

// ─── GET /api/v1/analytics/traffic ───────────────────────────────────────────
//
// Query: ?from= &to= &granularity=hour|day (default: day)
// TTL: 300s (near real-time)

router.get('/traffic', async (req, res, next) => {
  try {
    let { from, to } = parseDateRange(req.query);

    const granularity = parseGranularity(req.query.granularity);
    const db    = req.db;
    const redis = getRedis();
    const slug  = req.propertySlug;

    const cacheKey = buildCacheKey(slug, 'traffic', { from, to, granularity });

    const data = await cachedQuery(redis, cacheKey, 300, async () => {
      // date_trunc requires a string literal for granularity — we control the
      // value above so interpolation is safe (not user input).
      const { rows } = await db.query(
        `SELECT
           date_trunc($1, timestamp)                                AS bucket,
           COUNT(*)                                                  AS visits,
           COUNT(*) FILTER (WHERE result = 'allowed')               AS admitted,
           COUNT(*) FILTER (WHERE result = 'denied')                AS denied
         FROM visit_logs
         WHERE timestamp BETWEEN $2 AND $3
         GROUP BY 1
         ORDER BY 1`,
        [granularity, from, to],
      );

      const labels   = rows.map(r => new Date(r.bucket).toISOString());
      const visits   = rows.map(r => Number(r.visits));
      const admitted = rows.map(r => Number(r.admitted));
      const denied   = rows.map(r => Number(r.denied));

      return {
        granularity,
        from: from.toISOString(),
        to:   to.toISOString(),
        labels,
        series: { visits, admitted, denied },
      };
    });

    if (req.query.format === 'csv') {
      const csvRows = data.labels.map((label, i) => ({
        bucket:   label,
        visits:   data.series.visits[i],
        admitted: data.series.admitted[i],
        denied:   data.series.denied[i],
      }));
      return sendCSV(res, 'traffic.csv', ['bucket', 'visits', 'admitted', 'denied'], csvRows);
    }

    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

// ─── GET /api/v1/analytics/top-residents ────────────────────────────────────
//
// Query: ?from= &to= &limit=10 (max 50)
// TTL: 300s

router.get('/top-residents', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const db    = req.db;
    const redis = getRedis();
    const slug  = req.propertySlug;

    const cacheKey = buildCacheKey(slug, 'top-residents', { from, to, limit });

    const data = await cachedQuery(redis, cacheKey, 300, async () => {
      const { rows } = await db.query(
        `SELECT
           r.created_by_uid                     AS uid,
           u.name,
           u.apartment,
           COUNT(DISTINCT r.id)                 AS pass_count,
           COUNT(DISTINCT vl.id)                AS guest_count
         FROM requests r
         JOIN users u ON u.uid = r.created_by_uid
         LEFT JOIN visit_logs vl
           ON vl.created_by_apt = r.created_by_apt
          AND vl.timestamp BETWEEN $1 AND $2
         WHERE r.created_at BETWEEN $1 AND $2
           AND r.deleted_at IS NULL
         GROUP BY r.created_by_uid, u.name, u.apartment
         ORDER BY pass_count DESC
         LIMIT $3`,
        [from, to, limit],
      );

      return {
        residents: rows.map(r => ({
          uid:        r.uid,
          name:       r.name,
          apartment:  r.apartment,
          pass_count: Number(r.pass_count),
          guest_count: Number(r.guest_count),
        })),
      };
    });

    if (req.query.format === 'csv') {
      return sendCSV(
        res, 'top-residents.csv',
        ['uid', 'name', 'apartment', 'pass_count', 'guest_count'],
        data.residents,
      );
    }

    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

// ─── GET /api/v1/analytics/sla ───────────────────────────────────────────────
//
// Query: ?from= &to=
// TTL: 3600s (daily aggregate)

router.get('/sla', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const db    = req.db;
    const redis = getRedis();
    const slug  = req.propertySlug;

    const cacheKey = buildCacheKey(slug, 'sla', { from, to });

    const data = await cachedQuery(redis, cacheKey, 3600, async () => {
      const { rows } = await db.query(
        `SELECT
           r.type,
           COUNT(*)                                                                          AS total,
           COUNT(*) FILTER (
             WHERE r.created_at + (s.sla_hours || ' hours')::INTERVAL >= r.updated_at
               OR r.status NOT IN ('completed','rejected','cancelled')
           )                                                                                 AS within_sla,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM request_history h
               WHERE h.req_id = r.id AND h.label = 'sla_overdue_notified'
             )
           )                                                                                 AS overdue,
           ROUND(
             AVG(EXTRACT(EPOCH FROM (r.updated_at - r.created_at))/3600)::numeric, 1
           )                                                                                 AS avg_resolution_hours
         FROM requests r
         LEFT JOIN request_sla_config s ON s.request_type = r.type
         WHERE r.created_at BETWEEN $1 AND $2
           AND r.deleted_at IS NULL
         GROUP BY r.type
         ORDER BY total DESC`,
        [from, to],
      );

      return {
        from: from.toISOString(),
        to:   to.toISOString(),
        byType: rows.map(r => ({
          type:                r.type,
          total:               Number(r.total),
          within_sla:          Number(r.within_sla),
          overdue:             Number(r.overdue),
          avg_resolution_hours: r.avg_resolution_hours !== null ? Number(r.avg_resolution_hours) : null,
        })),
      };
    });

    if (req.query.format === 'csv') {
      return sendCSV(
        res, 'sla.csv',
        ['type', 'total', 'within_sla', 'overdue', 'avg_resolution_hours'],
        data.byType,
      );
    }

    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

// ─── GET /api/v1/analytics/requests ─────────────────────────────────────────
//
// Query: ?from= &to=
// TTL: 300s (near real-time)

router.get('/requests', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const db    = req.db;
    const redis = getRedis();
    const slug  = req.propertySlug;

    const cacheKey = buildCacheKey(slug, 'requests', { from, to });

    const data = await cachedQuery(redis, cacheKey, 300, async () => {
      const base = `FROM requests WHERE created_at BETWEEN $1 AND $2 AND deleted_at IS NULL`;

      const [statusRows, typeRows, hourRows] = await Promise.all([
        db.query(`SELECT status, COUNT(*) AS count ${base} GROUP BY status`, [from, to]),
        db.query(`SELECT type,   COUNT(*) AS count ${base} GROUP BY type`,   [from, to]),
        db.query(
          `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS count
           ${base}
           GROUP BY hour
           ORDER BY hour`,
          [from, to],
        ),
      ]);

      const byStatus = {};
      for (const r of statusRows.rows) byStatus[r.status] = Number(r.count);

      const byType = {};
      for (const r of typeRows.rows) byType[r.type] = Number(r.count);

      const byHour = hourRows.rows.map(r => ({ hour: r.hour, count: Number(r.count) }));

      return { byStatus, byType, byHour };
    });

    if (req.query.format === 'csv') {
      // Flatten byHour as the primary table; include byStatus/byType as separate sections
      // is not practical in a single CSV — export byHour which is the time-series view
      const rows = data.byHour.map(r => ({
        hour:  r.hour,
        count: r.count,
      }));
      return sendCSV(res, 'requests-by-hour.csv', ['hour', 'count'], rows);
    }

    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

// ─── GET /api/v1/analytics/packages ─────────────────────────────────────────
//
// Query: ?from= &to=
// TTL: 3600s (daily aggregate)

router.get('/packages', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const db    = req.db;
    const redis = getRedis();
    const slug  = req.propertySlug;

    const cacheKey = buildCacheKey(slug, 'packages', { from, to });

    const data = await cachedQuery(redis, cacheKey, 3600, async () => {
      const { rows } = await db.query(
        `SELECT
           COUNT(*)                                                      AS received,
           COUNT(*) FILTER (WHERE status = 'picked_up')                 AS picked_up,
           COUNT(*) FILTER (WHERE status = 'awaiting_pickup')           AS pending,
           ROUND(AVG(
             CASE WHEN picked_up_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (picked_up_at - received_at))/3600
             END
           )::numeric, 1)                                                AS avg_pickup_hours
         FROM packages
         WHERE received_at BETWEEN $1 AND $2`,
        [from, to],
      );

      const r = rows[0] || {};
      return {
        received:         Number(r.received   || 0),
        picked_up:        Number(r.picked_up  || 0),
        pending:          Number(r.pending    || 0),
        avg_pickup_hours: r.avg_pickup_hours !== null && r.avg_pickup_hours !== undefined
          ? Number(r.avg_pickup_hours) : null,
      };
    });

    if (req.query.format === 'csv') {
      return sendCSV(
        res, 'packages.csv',
        ['received', 'picked_up', 'pending', 'avg_pickup_hours'],
        [data],
      );
    }

    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

module.exports = router;
