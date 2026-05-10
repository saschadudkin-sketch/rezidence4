'use strict';

const express = require('express');
const { getPlatformDb } = require('../../db');
const { getPlanKeys, normalizePlan } = require('../../config/featureFlags');
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

// Enum values mirror the CHECK constraints in platformMigrations 004.  Keep
// them in sync — DB check is the last line of defense, the API should reject
// bad input with a 400 before it ever reaches a transaction.
const PROPERTY_TYPES = new Set(['residential_complex', 'club_house', 'cottage_community']);
const PROPERTY_STATUSES = new Set(['active', 'suspended', 'maintenance', 'terminated']);
const PROPERTY_PLANS = new Set(getPlanKeys());

// Accepts standard CSS color forms: #rgb, #rrggbb, #rrggbbaa, and a small
// whitelist of named keywords we actually style against.  Values are stored
// as-is so the frontend can round-trip them into CSS without normalisation.
const COLOR_RE = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]{3,20})$/;

// Validate an https:// URL for branding assets.  Plain http: is rejected
// because the tenant SPA is served over TLS and would trigger mixed-content
// warnings.  Short cap prevents accidental paste of entire base64 blobs.
function isValidHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

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

function statusToIsActive(status) {
  return status === 'active';
}

function currentLifecycleStatus(property) {
  return property.status || (property.is_active ? 'active' : 'suspended');
}

function normalizeLifecycleReason(reason) {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) return null;
  return trimmed;
}

function parsePropertyPlan(raw, { allowDefault = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return allowDefault ? 'core_access' : null;
  }
  if (typeof raw !== 'string') return null;
  const normalized = normalizePlan(raw);
  return PROPERTY_PLANS.has(normalized) ? normalized : null;
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
      property_type,
      status,
      logo_url,
      primary_color,
      management_company_id,
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

    const normalizedPlan = parsePropertyPlan(plan, { allowDefault: true });
    if (!normalizedPlan) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `plan must be one of: ${[...PROPERTY_PLANS].join(', ')}`,
        },
      });
    }

    if (property_type !== undefined && !PROPERTY_TYPES.has(property_type)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `property_type must be one of: ${[...PROPERTY_TYPES].join(', ')}`,
        },
      });
    }

    if (status !== undefined && !PROPERTY_STATUSES.has(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `status must be one of: ${[...PROPERTY_STATUSES].join(', ')}`,
        },
      });
    }

    if (logo_url !== undefined && logo_url !== null && !isValidHttpsUrl(logo_url)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'logo_url must be an https:// URL under 2048 chars' },
      });
    }

    if (primary_color !== undefined && primary_color !== null && !COLOR_RE.test(primary_color)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'primary_color must be a CSS color (e.g. #7c3aed or a named color)',
        },
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

    // If a management_company_id is supplied, validate it exists + is active.
    // Allows null / undefined (property is either self-managed or gets its
    // MC assigned later via PATCH).
    if (management_company_id) {
      const { rows: mcRows } = await platformDb.query(
        `SELECT id FROM management_companies
          WHERE id = $1 AND status = 'active'`,
        [management_company_id],
      );
      if (!mcRows.length) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `management_company_id '${management_company_id}' not found or not active`,
          },
        });
      }
    }

    const initialStatus = status || 'active';
    const { rows } = await platformDb.query(
      `INSERT INTO properties
         (slug, name, address, db_connection_url, plan, timezone,
          contact_email, contact_phone,
          property_type, status, is_active, logo_url, primary_color, management_company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        slug,
        name,
        address || null,
        db_connection_url,
        normalizedPlan,
        timezone || 'Europe/Moscow',
        contact_email || null,
        contact_phone || null,
        property_type || 'residential_complex',
        initialStatus,
        statusToIsActive(initialStatus),
        logo_url || null,
        primary_color || null,
        management_company_id || null,
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

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'status changes must use POST /platform/api/v1/properties/:slug/lifecycle',
        },
      });
    }

    // Explicitly forbid changing slug or db_connection_url.  `hostname` is
    // updatable (that's how a new property gets its subdomain wired up) but
    // validated + uniqueness-checked below.  The Phase-1 fields
    // (property_type / branding / management_company_id) are editable
    // post-creation from the superadmin SPA. Status changes are lifecycle
    // actions and go through the dedicated endpoint below so they carry an
    // operator reason in audit.
    const allowed = [
      'name',
      'address',
      'plan',
      'timezone',
      'contact_email',
      'contact_phone',
      'hostname',
      'property_type',
      'logo_url',
      'primary_color',
      'management_company_id',
    ];
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

    // Phase-1 field validation.  Mirrors the POST route rules.  Enum fields
    // are validated only when they are explicitly present in the patch body —
    // `undefined` means "leave it alone", `null` is rejected for non-null
    // fields (property_type) and accepted for nullable branding
    // fields (logo_url, primary_color, management_company_id).
    if (Object.prototype.hasOwnProperty.call(changes, 'property_type')) {
      if (!PROPERTY_TYPES.has(changes.property_type)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `property_type must be one of: ${[...PROPERTY_TYPES].join(', ')}`,
          },
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'plan')) {
      const normalizedPlan = parsePropertyPlan(changes.plan);
      if (!normalizedPlan) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `plan must be one of: ${[...PROPERTY_PLANS].join(', ')}`,
          },
        });
      }
      changes.plan = normalizedPlan;
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'logo_url')) {
      const raw = changes.logo_url;
      if (raw === null || raw === '') {
        changes.logo_url = null;
      } else if (!isValidHttpsUrl(raw)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'logo_url must be an https:// URL under 2048 chars' },
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'primary_color')) {
      const raw = changes.primary_color;
      if (raw === null || raw === '') {
        changes.primary_color = null;
      } else if (typeof raw !== 'string' || !COLOR_RE.test(raw)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'primary_color must be a CSS color (e.g. #7c3aed or a named color)',
          },
        });
      }
    }

    const platformDb = getPlatformDb();

    // management_company_id existence check (skip when clearing to null).
    // Using an explicit 'active'-filter rejects accidental reassignment to
    // a suspended/terminated MC — admins have to reactivate the MC first.
    if (Object.prototype.hasOwnProperty.call(changes, 'management_company_id')) {
      const raw = changes.management_company_id;
      if (raw === null || raw === '') {
        changes.management_company_id = null;
      } else {
        const { rows: mcRows } = await platformDb.query(
          `SELECT id FROM management_companies
            WHERE id = $1 AND status = 'active'`,
          [raw],
        );
        if (!mcRows.length) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `management_company_id '${raw}' not found or not active`,
            },
          });
        }
      }
    }

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

// POST /platform/api/v1/properties/:slug/lifecycle
router.post('/:slug/lifecycle', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { status, reason } = req.body || {};

    if (!PROPERTY_STATUSES.has(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `status must be one of: ${[...PROPERTY_STATUSES].join(', ')}`,
        },
      });
    }

    const normalizedReason = normalizeLifecycleReason(reason);
    if (!normalizedReason) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'reason is required and must be 3-500 characters',
        },
      });
    }

    const platformDb = getPlatformDb();
    const { rows: existingRows } = await platformDb.query(
      'SELECT id, slug, status, is_active FROM properties WHERE slug = $1',
      [slug],
    );

    if (!existingRows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const current = existingRows[0];
    const fromStatus = currentLifecycleStatus(current);
    if (fromStatus === status) {
      return res.status(409).json({
        error: {
          code: 'LIFECYCLE_NOOP',
          message: `Property '${slug}' is already '${status}'`,
        },
      });
    }

    const nextIsActive = statusToIsActive(status);
    const { rows } = await platformDb.query(
      `UPDATE properties
          SET status = $2,
              is_active = $3,
              updated_at = NOW()
        WHERE slug = $1
        RETURNING *`,
      [slug, status, nextIsActive],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Property '${slug}' not found` },
      });
    }

    const property = rows[0];
    const lifecycle = {
      from_status: fromStatus,
      to_status: status,
      from_is_active: current.is_active,
      to_is_active: nextIsActive,
      reason: normalizedReason,
    };

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'property.lifecycle_changed',
      propertyId: property.id,
      ipAddress: req.ip,
      details: lifecycle,
    });

    logger.info(
      { slug, fromStatus, toStatus: status },
      '[platform/properties] property lifecycle changed',
    );

    return res.json({ property, lifecycle });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/properties/:slug/disable
router.post('/:slug/disable', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    // Keep legacy is_active in lockstep with the richer `status` lifecycle.
    // Disabling → 'suspended' (most common reason for a disable today); admins
    // can later refine to 'maintenance' / 'terminated' via /lifecycle.
    const { rows } = await platformDb.query(
      `UPDATE properties
          SET is_active = false,
              status = 'suspended',
              updated_at = NOW()
        WHERE slug = $1
        RETURNING *`,
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

    // Re-enabling resets the lifecycle to 'active'.  If admins want a more
    // nuanced state (e.g. 'maintenance' while staff verifies), they should
    // use /lifecycle directly.
    const { rows } = await platformDb.query(
      `UPDATE properties
          SET is_active = true,
              status = 'active',
              updated_at = NOW()
        WHERE slug = $1
        RETURNING *`,
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
