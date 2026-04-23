'use strict';

// Phase 1 (D-lite) management-company CRUD for the superadmin SPA.
// See: ROADMAP.md §"Фаза 1", docs/product/specs/platform-v1/README.md,
// RECONCILIATION.md §1.2.  Tables are defined in platformMigrations 005.
//
// The endpoints are intentionally close in shape to /platform/api/v1/admins
// and /platform/api/v1/properties so the SPA can reuse form + list patterns.
// Every mutation writes to platform_audit_log with actor_type='platform_admin'
// (the column was introduced in platformMigrations 006).

const express = require('express');
const { getPlatformDb } = require('../../db');
const logger = require('../../logger');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();
router.use(platformAuth);

// MC slugs share the property slug grammar — same DNS-friendly rules so we
// can later surface them as `/{mcSlug}/...` URLs without re-encoding.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$/;

// Russian ИНН is 10 or 12 digits.  Optional, because some MCs are foreign
// branches or freshly registered and don't have one yet; the schema allows NULL.
const INN_RE = /^(\d{10}|\d{12})$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MC_STATUSES = new Set(['active', 'suspended', 'terminated']);

// Helper: fire-and-forget audit entry.  actor_type is mandatory since 006;
// we record the MC id in the dedicated column so audit filters per-MC don't
// have to JSON-parse `details`.
function auditLog({ adminId, action, managementCompanyId = null, ipAddress, details = null }) {
  getPlatformDb()
    .query(
      `INSERT INTO platform_audit_log
         (admin_id, actor_type, action, management_company_id, details, ip_address)
       VALUES ($1, 'platform_admin', $2, $3, $4, $5)`,
      [
        adminId,
        action,
        managementCompanyId,
        details ? JSON.stringify(details) : null,
        ipAddress,
      ],
    )
    .catch((err) => logger.warn({ err, action }, '[platform/management-companies] audit log write failed'));
}

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

// GET /platform/api/v1/management-companies
// Optional ?status=active|suspended|terminated filter.  Otherwise returns
// every row; the SPA's default view filters client-side.
router.get('/', async (req, res, next) => {
  try {
    const platformDb = getPlatformDb();
    const params = [];
    let sql = `
      SELECT mc.*,
             (
               SELECT COUNT(*)::int
                 FROM properties p
                WHERE p.management_company_id = mc.id
             ) AS properties_count
        FROM management_companies mc
    `;

    if (req.query.status !== undefined) {
      if (!MC_STATUSES.has(req.query.status)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `status must be one of: ${[...MC_STATUSES].join(', ')}`,
          },
        });
      }
      params.push(req.query.status);
      sql += ' WHERE mc.status = $1';
    }

    sql += ' ORDER BY mc.created_at DESC';

    const { rows } = await platformDb.query(sql, params);
    return res.json({ managementCompanies: rows });
  } catch (err) {
    next(err);
  }
});

// GET /platform/api/v1/management-companies/:slug
// Returns the MC plus a shallow list of its properties and the 10 most
// recent audit entries.  Mirrors GET /properties/:slug.
router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    const { rows } = await platformDb.query(
      'SELECT * FROM management_companies WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Management company '${slug}' not found` },
      });
    }

    const managementCompany = rows[0];

    const { rows: properties } = await platformDb.query(
      `SELECT id, slug, name, status, is_active, created_at
         FROM properties
        WHERE management_company_id = $1
        ORDER BY created_at DESC`,
      [managementCompany.id],
    );

    const { rows: recentAudit } = await platformDb.query(
      `SELECT pal.*, pa.name AS admin_name
         FROM platform_audit_log pal
         LEFT JOIN platform_admins pa ON pa.id = pal.admin_id
        WHERE pal.management_company_id = $1
        ORDER BY pal.created_at DESC
        LIMIT 10`,
      [managementCompany.id],
    );

    return res.json({ managementCompany, properties, recentAudit });
  } catch (err) {
    next(err);
  }
});

// POST /platform/api/v1/management-companies
router.post('/', async (req, res, next) => {
  try {
    const {
      slug,
      name,
      inn,
      contact_email,
      contact_phone,
      website,
      logo_url,
    } = req.body || {};

    if (!slug || !SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'slug is required and must match ^[a-z0-9][a-z0-9-]{2,78}[a-z0-9]$',
        },
      });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'name is required' },
      });
    }

    if (inn !== undefined && inn !== null && inn !== '' && !INN_RE.test(inn)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'inn must be 10 or 12 digits' },
      });
    }

    if (
      contact_email !== undefined
      && contact_email !== null
      && contact_email !== ''
      && !EMAIL_RE.test(contact_email)
    ) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'contact_email must be a valid email address' },
      });
    }

    if (
      website !== undefined
      && website !== null
      && website !== ''
      && !isValidHttpsUrl(website)
    ) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'website must be an https:// URL under 2048 chars' },
      });
    }

    if (
      logo_url !== undefined
      && logo_url !== null
      && logo_url !== ''
      && !isValidHttpsUrl(logo_url)
    ) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'logo_url must be an https:// URL under 2048 chars' },
      });
    }

    const platformDb = getPlatformDb();

    const { rows: existing } = await platformDb.query(
      'SELECT id FROM management_companies WHERE slug = $1',
      [slug],
    );
    if (existing.length) {
      return res.status(409).json({
        error: {
          code: 'SLUG_EXISTS',
          message: `A management company with slug '${slug}' already exists`,
        },
      });
    }

    const { rows } = await platformDb.query(
      `INSERT INTO management_companies
         (slug, name, inn, contact_email, contact_phone, website, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        slug,
        name.trim(),
        inn || null,
        contact_email || null,
        contact_phone || null,
        website || null,
        logo_url || null,
      ],
    );

    const managementCompany = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'management_company.created',
      managementCompanyId: managementCompany.id,
      ipAddress: req.ip,
      details: { slug, name: name.trim() },
    });

    logger.info(
      { slug, managementCompanyId: managementCompany.id },
      '[platform/management-companies] management company created',
    );

    return res.status(201).json({ managementCompany });
  } catch (err) {
    next(err);
  }
});

// PATCH /platform/api/v1/management-companies/:slug
// Slug is immutable (same reasoning as properties.slug — it's the stable
// reference everything else points at).  Status changes go through here
// rather than a separate /suspend endpoint: the SPA is happy to POST a
// single field.
router.patch('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const allowed = [
      'name',
      'inn',
      'contact_email',
      'contact_phone',
      'website',
      'logo_url',
      'status',
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

    if (Object.prototype.hasOwnProperty.call(changes, 'name')) {
      if (typeof changes.name !== 'string' || !changes.name.trim()) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'name must be a non-empty string' },
        });
      }
      changes.name = changes.name.trim();
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'inn')) {
      const raw = changes.inn;
      if (raw === null || raw === '') {
        changes.inn = null;
      } else if (!INN_RE.test(raw)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'inn must be 10 or 12 digits' },
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'contact_email')) {
      const raw = changes.contact_email;
      if (raw === null || raw === '') {
        changes.contact_email = null;
      } else if (!EMAIL_RE.test(raw)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'contact_email must be a valid email address' },
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'website')) {
      const raw = changes.website;
      if (raw === null || raw === '') {
        changes.website = null;
      } else if (!isValidHttpsUrl(raw)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'website must be an https:// URL under 2048 chars' },
        });
      }
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

    if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
      if (!MC_STATUSES.has(changes.status)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `status must be one of: ${[...MC_STATUSES].join(', ')}`,
          },
        });
      }
    }

    const platformDb = getPlatformDb();

    const setClauses = Object.keys(changes).map((key, i) => `${key} = $${i + 2}`);
    setClauses.push('updated_at = NOW()');
    const values = [slug, ...Object.values(changes)];

    const { rows } = await platformDb.query(
      `UPDATE management_companies
          SET ${setClauses.join(', ')}
        WHERE slug = $1
        RETURNING *`,
      values,
    );

    if (!rows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Management company '${slug}' not found` },
      });
    }

    const managementCompany = rows[0];

    auditLog({
      adminId: req.platformAdmin.id,
      action: 'management_company.updated',
      managementCompanyId: managementCompany.id,
      ipAddress: req.ip,
      details: { changes },
    });

    return res.json({ managementCompany });
  } catch (err) {
    next(err);
  }
});

// GET /platform/api/v1/management-companies/:slug/admins
// The admins sub-resource is read-only here in Phase 1.  Creation happens in
// the next sprint once we have a dedicated onboarding flow for MC admins.
// Exposing the read-side now lets the SPA show "0 admins yet" badges and
// the eventual email-invite button on the detail page.
router.get('/:slug/admins', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const platformDb = getPlatformDb();

    const { rows: mcRows } = await platformDb.query(
      'SELECT id FROM management_companies WHERE slug = $1',
      [slug],
    );
    if (!mcRows.length) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Management company '${slug}' not found` },
      });
    }

    const { rows: admins } = await platformDb.query(
      `SELECT id, email, name, is_active, last_login_at, created_at
         FROM management_company_admins
        WHERE management_company_id = $1
        ORDER BY created_at`,
      [mcRows[0].id],
    );

    return res.json({ admins });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
