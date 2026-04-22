'use strict';

const express = require('express');
const { getPlatformDb } = require('../../db');
const logger = require('../../logger');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();
router.use(platformAuth);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/;
// Conservative DNS hostname regex: lowercased, dot-separated labels, each 1-63
// chars, no leading/trailing hyphens.  Total length capped at 253 so we stay
// within the DNS spec.  We accept either a bare domain (app.domhub.su) or an
// empty string / null to clear the hostname.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Helper: log an audit entry (fire-and-forget)
function auditLog({ adminId, action, propertyId = null, ipAddress, details = null }) {
  getPlatformDb()
    .query(
      `INSERT INTO platform_audit_log (admin_id, action, property_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, propertyId, details ? JSON.stringify(details) : null, ipAddress],
    )
    .catch((err) => logger.warn({ err, action }, '[platform/properties] audit log write failed'));
}

// GET /platform/api/v1/properties
router.get('/', async (req, res, next) => {
  try {
    const platformDb = getPlatformDb();
    let sql = 'SELECT * FROM properties ORDER BY created_at DESC';
    const params = [];

    if (req.query.active !== undefined) {
      const activeFilter = req.query.active === 'true';
      sql = 'SELECT * FROM properties WHERE is_active = $1 ORDER BY created_at DESC';
      params.push(activeFilter);
    }

    const { rows } = await platformDb.query(sql, params);
    return res.json({ properties: rows });
  } catch (err) {
    next(err);
  }
});

// GET /platform/api/v1/properties/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    const { rows } = await platformDb.query(
      'SELECT * FROM properties WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const property = rows[0];

    const { rows: recentAudit } = await platformDb.query(
      `SELECT pal.*, pa.name AS admin_name
       FROM platform_audit_log pal
       LEFT JOIN platform_admins pa ON pa.id = pal.admin_id
       WHERE pal.property_id = $1
       ORDER BY pal.created_at DESC
       LIMIT 10`,
      [property.id],
    );

    return res.json({ property, recentAudit });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/properties
router.post('/', async (req, res, next) => {
  try {
    const {
      slug,
      name,
      address,
      db_connection_url,
      plan,
      timezone,
      contact_email,
      contact_phone,
    } = req.body || {};

    // Validate slug
    if (!slug || !SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'slug is required and must match ^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$',
        },
      });
    }

    // Validate db_connection_url
    if (!db_connection_url || !db_connection_url.startsWith('postgresql://')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'db_connection_url is required and must start with postgresql://',
        },
      });
    }

    if (!name) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'name is required' },
      });
    }

    const platformDb = getPlatformDb();

    // Check slug uniqueness
    const { rows: existing } = await platformDb.query(
      'SELECT id FROM properties WHERE slug = $1',
      [slug],
    );
    if (existing.length) {
      return res.status(409).json({
        error: { code: 'SLUG_EXISTS', message: `A property with slug '${slug}' already exists` },
      });
    }

    const { rows } = await platformDb.query(
      `INSERT INTO properties
         (slug, name, address, db_connection_url, plan, timezone, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        slug,
        name,
        address || null,
        db_connection_url,
        plan || 'standard',
        timezone || 'Europe/Moscow',
        contact_email || null,
        contact_phone || null,
      ],
    );

    const property = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'property.created',
      propertyId: property.id,
      ipAddress: req.ip,
      details: { slug, name },
    });

    logger.info({ slug, propertyId: property.id }, '[platform/properties] property created');

    return res.status(201).json({ property });
  } catch (err) {
    next(err);
  }
});

// PATCH /platform/api/v1/properties/:slug
router.patch('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    // Explicitly forbid changing slug or db_connection_url.  `hostname` is
    // updatable (that's how a new property gets its subdomain wired up) but
    // validated + uniqueness-checked below.
    const allowed = ['name', 'address', 'plan', 'timezone', 'contact_email', 'contact_phone', 'hostname'];
    const changes = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        changes[key] = req.body[key];
      }
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'No updatable fields provided' },
      });
    }

    // Normalise + validate hostname if present.  Accept null / '' to clear;
    // otherwise lowercase + regex-check.  Uniqueness is enforced by the
    // partial unique index (see platformMigrations 003), but we do a pre-flight
    // check here so we can return a 409 rather than a generic 500.
    if (Object.prototype.hasOwnProperty.call(changes, 'hostname')) {
      const raw = changes.hostname;
      if (raw === null || raw === '') {
        changes.hostname = null;
      } else if (typeof raw !== 'string') {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'hostname must be a string, null, or empty' },
        });
      } else {
        const normalised = raw.trim().toLowerCase();
        if (!HOSTNAME_RE.test(normalised)) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'hostname must be a lowercase DNS name (e.g. app.domhub.su)',
            },
          });
        }
        changes.hostname = normalised;
      }
    }

    const platformDb = getPlatformDb();

    // Uniqueness pre-flight (only when setting a non-null hostname).  Allow
    // the current row to keep its own hostname — filter by slug mismatch.
    if (changes.hostname) {
      const { rows: clash } = await platformDb.query(
        'SELECT slug FROM properties WHERE hostname = $1 AND slug <> $2',
        [changes.hostname, slug],
      );
      if (clash.length) {
        return res.status(409).json({
          error: {
            code: 'HOSTNAME_EXISTS',
            message: `hostname '${changes.hostname}' is already assigned to property '${clash[0].slug}'`,
          },
        });
      }
    }

    // Build dynamic SET clause
    const setClauses = Object.keys(changes).map((key, i) => `${key} = $${i + 2}`);
    setClauses.push('updated_at = NOW()');
    const values = [slug, ...Object.values(changes)];

    const { rows } = await platformDb.query(
      `UPDATE properties SET ${setClauses.join(', ')} WHERE slug = $1 RETURNING *`,
      values,
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const property = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'property.updated',
      propertyId: property.id,
      ipAddress: req.ip,
      details: { changes },
    });

    return res.json({ property });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/properties/:slug/disable
router.post('/:slug/disable', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    const { rows } = await platformDb.query(
      'UPDATE properties SET is_active = false, updated_at = NOW() WHERE slug = $1 RETURNING *',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const property = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'property.disabled',
      propertyId: property.id,
      ipAddress: req.ip,
    });

    logger.info({ slug }, '[platform/properties] property disabled');

    return res.json({ property });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/properties/:slug/enable
router.post('/:slug/enable', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    const { rows } = await platformDb.query(
      'UPDATE properties SET is_active = true, updated_at = NOW() WHERE slug = $1 RETURNING *',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const property = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'property.enabled',
      propertyId: property.id,
      ipAddress: req.ip,
    });

    logger.info({ slug }, '[platform/properties] property enabled');

    return res.json({ property });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
