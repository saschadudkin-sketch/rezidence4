'use strict';

/**
 * routes/platform/auditLog.js — superadmin audit trail reader.
 *
 * GET /platform/api/v1/audit-log
 *   Query parameters (all optional):
 *     limit         — page size, 1..200, default 50
 *     offset        — zero-based offset, default 0
 *     action        — exact match on audit action name (e.g. 'property.updated')
 *     admin_id      — filter to a single platform admin (uuid)
 *     property_id   — filter to a single property (uuid)
 *     since         — ISO 8601 timestamp; only rows with created_at >= since
 *     until         — ISO 8601 timestamp; only rows with created_at <  until
 *
 * Returns:
 *   {
 *     entries: [...rows with admin_name and property_slug joined in...],
 *     total:   number,   // total rows matching filter (for pagination)
 *     limit:   number,
 *     offset:  number
 *   }
 *
 * The stats endpoint returns only the most recent 20 entries on the dashboard;
 * this route exists so the superadmin SPA can page through the full trail and
 * filter by action / admin / property for investigations.
 */

const express = require('express');
const { getPlatformDb } = require('../../db');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();
router.use(platformAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;  // undefined signals bad input
}

router.get('/', async (req, res, next) => {
  try {
    // ── Parse + validate query params ────────────────────────────────────────
    let limit = Number.parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    let offset = Number.parseInt(req.query.offset, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const { action, admin_id: adminId, property_id: propertyId } = req.query;

    if (adminId && !UUID_RE.test(adminId)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'admin_id must be a UUID' },
      });
    }
    if (propertyId && !UUID_RE.test(propertyId)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'property_id must be a UUID' },
      });
    }

    const since = parseIsoDate(req.query.since);
    const until = parseIsoDate(req.query.until);
    if (since === undefined) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'since must be an ISO 8601 timestamp' },
      });
    }
    if (until === undefined) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'until must be an ISO 8601 timestamp' },
      });
    }

    // ── Build WHERE clause dynamically ───────────────────────────────────────
    const where = [];
    const params = [];
    const push = (sql, value) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };

    if (action)     push('pal.action      = $?', action);
    if (adminId)    push('pal.admin_id    = $?', adminId);
    if (propertyId) push('pal.property_id = $?', propertyId);
    if (since)      push('pal.created_at >= $?', since);
    if (until)      push('pal.created_at <  $?', until);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const platformDb = getPlatformDb();

    // ── Total count (for pagination UI) ──────────────────────────────────────
    const { rows: countRows } = await platformDb.query(
      `SELECT COUNT(*)::int AS total FROM platform_audit_log pal ${whereSql}`,
      params,
    );
    const total = countRows[0].total;

    // ── Page of entries with admin name and property slug joined in ──────────
    const pageParams = [...params, limit, offset];
    const { rows: entries } = await platformDb.query(
      `SELECT pal.*,
              pa.name AS admin_name,
              pa.email AS admin_email,
              p.slug AS property_slug,
              p.name AS property_name
       FROM platform_audit_log pal
       LEFT JOIN platform_admins pa ON pa.id = pal.admin_id
       LEFT JOIN properties p ON p.id = pal.property_id
       ${whereSql}
       ORDER BY pal.created_at DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );

    return res.json({ entries, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
