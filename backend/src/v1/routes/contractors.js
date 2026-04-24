'use strict';

// platform-v1 Contractor companies + contractor users routes.
// Spec: docs/product/specs/platform-v1/contractors-spec.md
// Phase: 2.
//
// Two resources (/contractor-companies and /contractor-users) share one
// router to keep Фаза-2 mounting simple.  Business rule worth noting:
// creating a contractor_user for a company whose status != 'active' returns
// 409 — the pass-issuance chain refuses inactive companies, but catching it
// at write-time prevents zombie rows.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const { isStaff, isAdmin } = require('../lib/authz');

const router = express.Router();
router.use(requireAuth);

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_STATUSES = new Set(['active', 'suspended', 'terminated']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{8,15}$/;

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim под legacy callsite — isPropertyAdmin = isAdmin из authz.
const isPropertyAdmin = isAdmin;
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}
function auditLog(req, { action, resourceType, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO audit_log(actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.user?.uid || null, req.user?.role || null, action, resourceType, resourceId, changes ? JSON.stringify(changes) : null, req.ip || null],
  ).catch((err) => logger.warn({ err, action }, '[v1/contractors] audit write failed'));
}

// ─── Companies ───────────────────────────────────────────────────────────────

// GET /api/v1/contractor-companies?status=&q=
router.get('/contractor-companies', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];
    if (req.query.status) {
      if (!COMPANY_STATUSES.has(req.query.status)) return res.status(400).json({ error: 'Invalid status' });
      params.push(req.query.status); filters.push(`status = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
      filters.push(`LOWER(name) LIKE $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await getDb(req).query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM contractor_users u WHERE u.contractor_company_id = c.id AND u.is_active = true)
                AS active_users_count
         FROM contractor_companies c
         ${where}
        ORDER BY name ASC LIMIT 500`,
      params,
    );
    res.json({ companies: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/contractor-companies/:id
router.get('/contractor-companies/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid company id' });
    const { rows } = await getDb(req).query(`SELECT * FROM contractor_companies WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Company not found' });
    const { rows: users } = await getDb(req).query(
      `SELECT * FROM contractor_users WHERE contractor_company_id = $1 ORDER BY full_name ASC`,
      [req.params.id],
    );
    res.json({ company: rows[0], users });
  } catch (err) { next(err); }
});

// POST /api/v1/contractor-companies
router.post('/contractor-companies', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, name,
      contact_name = null, contact_phone = null, contact_email = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isNonEmptyString(name, 200)) return res.status(400).json({ error: 'name required (1–200 chars)' });
    if (contact_email && !EMAIL_RE.test(String(contact_email))) return res.status(400).json({ error: 'Invalid contact_email' });
    if (contact_phone && !PHONE_RE.test(String(contact_phone))) return res.status(400).json({ error: 'contact_phone must be E.164-like' });

    const { rows } = await getDb(req).query(
      `INSERT INTO contractor_companies(property_id, name, contact_name, contact_phone, contact_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [property_id, name.trim(), contact_name || null, contact_phone || null, contact_email || null],
    );
    auditLog(req, {
      action: 'contractor_company.created',
      resourceType: 'contractor_company',
      resourceId: rows[0].id,
      changes: { name: rows[0].name },
    });
    res.status(201).json({ company: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'company name already exists for this property' });
    next(err);
  }
});

// PATCH /api/v1/contractor-companies/:id
router.patch('/contractor-companies/:id', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid company id' });

    const sets = [];
    const params = [];
    const changes = {};

    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name, 200)) return res.status(400).json({ error: 'name invalid' });
      params.push(req.body.name.trim()); sets.push(`name = $${params.length}`); changes.name = req.body.name.trim();
    }
    if (req.body.status !== undefined) {
      if (!COMPANY_STATUSES.has(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
      params.push(req.body.status); sets.push(`status = $${params.length}`); changes.status = req.body.status;
    }
    if (req.body.contact_name !== undefined) { params.push(req.body.contact_name || null); sets.push(`contact_name = $${params.length}`); changes.contact_name = req.body.contact_name; }
    if (req.body.contact_phone !== undefined) {
      if (req.body.contact_phone && !PHONE_RE.test(String(req.body.contact_phone))) return res.status(400).json({ error: 'contact_phone must be E.164-like' });
      params.push(req.body.contact_phone || null); sets.push(`contact_phone = $${params.length}`); changes.contact_phone = req.body.contact_phone;
    }
    if (req.body.contact_email !== undefined) {
      if (req.body.contact_email && !EMAIL_RE.test(String(req.body.contact_email))) return res.status(400).json({ error: 'Invalid contact_email' });
      params.push(req.body.contact_email || null); sets.push(`contact_email = $${params.length}`); changes.contact_email = req.body.contact_email;
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await getDb(req).query(
      `UPDATE contractor_companies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Company not found' });
    auditLog(req, { action: 'contractor_company.updated', resourceType: 'contractor_company', resourceId: rows[0].id, changes });
    res.json({ company: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'company name already exists for this property' });
    next(err);
  }
});

// ─── Users ───────────────────────────────────────────────────────────────────

// GET /api/v1/contractor-users?contractor_company_id=&is_active=
router.get('/contractor-users', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];
    if (req.query.contractor_company_id) {
      if (!isValidUuid(req.query.contractor_company_id)) return res.status(400).json({ error: 'Invalid contractor_company_id' });
      params.push(req.query.contractor_company_id); filters.push(`contractor_company_id = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      const active = req.query.is_active === 'true' || req.query.is_active === '1';
      params.push(active); filters.push(`is_active = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await getDb(req).query(
      `SELECT * FROM contractor_users ${where} ORDER BY full_name ASC LIMIT 500`,
      params,
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// POST /api/v1/contractor-users
router.post('/contractor-users', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const {
      contractor_company_id, property_id, full_name,
      phone = null, email = null, specialization = null,
      access_expires_at = null,
    } = req.body || {};

    if (!isValidUuid(contractor_company_id)) return res.status(400).json({ error: 'contractor_company_id must be UUID' });
    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isNonEmptyString(full_name, 200)) return res.status(400).json({ error: 'full_name required' });
    if (phone && !PHONE_RE.test(String(phone))) return res.status(400).json({ error: 'phone must be E.164-like' });
    if (email && !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Invalid email' });

    let expiresAt = null;
    if (access_expires_at) {
      const t = Date.parse(access_expires_at);
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'access_expires_at must be ISO 8601' });
      if (t <= Date.now()) return res.status(400).json({ error: 'access_expires_at must be in the future' });
      expiresAt = new Date(t).toISOString();
    }

    // Confirm the company is active.  This is a business-rule check — the DB
    // still permits the insert, but inactive companies can't issue passes.
    const { rows: companyCheck } = await getDb(req).query(
      `SELECT status FROM contractor_companies WHERE id = $1`,
      [contractor_company_id],
    );
    if (!companyCheck[0]) return res.status(400).json({ error: 'contractor_company_id does not exist' });
    if (companyCheck[0].status !== 'active') {
      return res.status(409).json({ error: `Cannot add user to company with status '${companyCheck[0].status}'` });
    }

    const { rows } = await getDb(req).query(
      `INSERT INTO contractor_users(
         contractor_company_id, property_id, full_name, phone, email,
         specialization, access_expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        contractor_company_id, property_id, full_name.trim(),
        phone || null, email || null, specialization || null, expiresAt,
      ],
    );
    auditLog(req, {
      action: 'contractor_user.created',
      resourceType: 'contractor_user',
      resourceId: rows[0].id,
      changes: { contractor_company_id, access_expires_at: expiresAt },
    });
    res.status(201).json({ user: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/v1/contractor-users/:id
router.patch('/contractor-users/:id', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

    const sets = [];
    const params = [];
    const changes = {};

    if (req.body.full_name !== undefined) {
      if (!isNonEmptyString(req.body.full_name, 200)) return res.status(400).json({ error: 'full_name invalid' });
      params.push(req.body.full_name.trim()); sets.push(`full_name = $${params.length}`); changes.full_name = req.body.full_name.trim();
    }
    if (req.body.phone !== undefined) {
      if (req.body.phone && !PHONE_RE.test(String(req.body.phone))) return res.status(400).json({ error: 'phone must be E.164-like' });
      params.push(req.body.phone || null); sets.push(`phone = $${params.length}`); changes.phone = req.body.phone || null;
    }
    if (req.body.email !== undefined) {
      if (req.body.email && !EMAIL_RE.test(String(req.body.email))) return res.status(400).json({ error: 'Invalid email' });
      params.push(req.body.email || null); sets.push(`email = $${params.length}`); changes.email = req.body.email || null;
    }
    if (req.body.specialization !== undefined) {
      params.push(req.body.specialization || null); sets.push(`specialization = $${params.length}`); changes.specialization = req.body.specialization || null;
    }
    if (req.body.access_expires_at !== undefined) {
      if (req.body.access_expires_at === null) {
        params.push(null); sets.push(`access_expires_at = $${params.length}`); changes.access_expires_at = null;
      } else {
        const t = Date.parse(req.body.access_expires_at);
        if (!Number.isFinite(t)) return res.status(400).json({ error: 'access_expires_at must be ISO 8601 or null' });
        params.push(new Date(t).toISOString()); sets.push(`access_expires_at = $${params.length}`); changes.access_expires_at = new Date(t).toISOString();
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await getDb(req).query(
      `UPDATE contractor_users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    auditLog(req, { action: 'contractor_user.updated', resourceType: 'contractor_user', resourceId: rows[0].id, changes });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/v1/contractor-users/:id/deactivate
router.post('/contractor-users/:id/deactivate', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    const { rows } = await getDb(req).query(
      `UPDATE contractor_users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    auditLog(req, { action: 'contractor_user.deactivated', resourceType: 'contractor_user', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
