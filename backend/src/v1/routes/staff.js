'use strict';

// platform-v1 Staff users route.
// Spec: docs/product/specs/platform-v1/staff-users-spec.md
// Phase: 2.
//
// Property-admin CRUD.  Default capability flags are auto-applied per role
// on creation (spec §3) and can be overridden explicitly by the caller.
// Role/capability changes are audited with before/after snapshots so that a
// security review can answer "who granted can_view_resident_phone to this
// guard, and when?" without trawling journal files.

const express = require('express');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = new Set(['security', 'concierge', 'technician', 'property_admin']);
const SPECIALIZATIONS = new Set(['plumbing', 'electric', 'cleaning', 'general']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{8,15}$/;

const ROLE_CAPABILITY_DEFAULTS = Object.freeze({
  security:       { can_view_resident_phone: false, can_assign_requests: false },
  concierge:      { can_view_resident_phone: true,  can_assign_requests: true },
  technician:     { can_view_resident_phone: false, can_assign_requests: false },
  property_admin: { can_view_resident_phone: true,  can_assign_requests: true },
});

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isPropertyAdmin(req) { return req.user && req.user.role === 'admin'; }
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function auditLog(req, { action, resourceId, changes }) {
  db.query(
    `INSERT INTO audit_log(actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, 'staff_user', $4, $5, $6)`,
    [req.user?.uid || null, req.user?.role || null, action, resourceId, changes ? JSON.stringify(changes) : null, req.ip || null],
  ).catch((err) => logger.warn({ err, action }, '[v1/staff] audit write failed'));
}

// GET /api/v1/staff?role=&is_active=&q=
router.get('/', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];
    if (req.query.role) {
      if (!STAFF_ROLES.has(req.query.role)) return res.status(400).json({ error: 'Invalid role' });
      params.push(req.query.role); filters.push(`role = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      const active = req.query.is_active === 'true' || req.query.is_active === '1';
      params.push(active); filters.push(`is_active = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
      filters.push(`(LOWER(full_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT * FROM staff_users ${where} ORDER BY full_name ASC LIMIT 500`,
      params,
    );
    res.json({ staff: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/staff/:id
router.get('/:id', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });
    const { rows } = await db.query(`SELECT * FROM staff_users WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
    res.json({ staff: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/v1/staff
router.post('/', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, full_name, email, role,
      phone = null, specialization = null,
      can_view_resident_phone, can_assign_requests,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isNonEmptyString(full_name, 200)) return res.status(400).json({ error: 'full_name required (1–200 chars)' });
    if (!EMAIL_RE.test(String(email || ''))) return res.status(400).json({ error: 'Invalid email' });
    if (!STAFF_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' });
    if (phone !== null && phone !== undefined && phone !== '' && !PHONE_RE.test(String(phone))) {
      return res.status(400).json({ error: 'phone must be E.164-like' });
    }
    if (specialization !== null && specialization !== undefined && specialization !== '' && !SPECIALIZATIONS.has(specialization)) {
      return res.status(400).json({ error: 'Invalid specialization' });
    }

    // Capability flags: caller override > role default.
    const defaults = ROLE_CAPABILITY_DEFAULTS[role];
    const effectivePhoneView = typeof can_view_resident_phone === 'boolean' ? can_view_resident_phone : defaults.can_view_resident_phone;
    const effectiveAssign = typeof can_assign_requests === 'boolean' ? can_assign_requests : defaults.can_assign_requests;

    const { rows } = await db.query(
      `INSERT INTO staff_users(
         property_id, full_name, phone, email, role, specialization,
         can_view_resident_phone, can_assign_requests
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        property_id, full_name.trim(), phone || null, email, role,
        specialization || null, effectivePhoneView, effectiveAssign,
      ],
    );
    auditLog(req, {
      action: 'staff.created',
      resourceId: rows[0].id,
      changes: {
        role,
        can_view_resident_phone: effectivePhoneView,
        can_assign_requests: effectiveAssign,
      },
    });
    res.status(201).json({ staff: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'email already exists for this property' });
    next(err);
  }
});

// PATCH /api/v1/staff/:id
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });

    // Read current row for audit before/after.
    const { rows: existing } = await db.query(`SELECT * FROM staff_users WHERE id = $1`, [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Staff not found' });
    const before = existing[0];

    const sets = [];
    const params = [];
    const changes = {};

    if (req.body.full_name !== undefined) {
      if (!isNonEmptyString(req.body.full_name, 200)) return res.status(400).json({ error: 'full_name invalid' });
      params.push(req.body.full_name.trim()); sets.push(`full_name = $${params.length}`);
      changes.full_name = { from: before.full_name, to: req.body.full_name.trim() };
    }
    if (req.body.phone !== undefined) {
      if (req.body.phone !== null && req.body.phone !== '' && !PHONE_RE.test(String(req.body.phone))) {
        return res.status(400).json({ error: 'phone must be E.164-like or null' });
      }
      params.push(req.body.phone || null); sets.push(`phone = $${params.length}`);
      changes.phone = { from: before.phone, to: req.body.phone || null };
    }
    if (req.body.role !== undefined) {
      if (!STAFF_ROLES.has(req.body.role)) return res.status(400).json({ error: 'Invalid role' });
      params.push(req.body.role); sets.push(`role = $${params.length}`);
      changes.role = { from: before.role, to: req.body.role };
    }
    if (req.body.specialization !== undefined) {
      if (req.body.specialization !== null && req.body.specialization !== '' && !SPECIALIZATIONS.has(req.body.specialization)) {
        return res.status(400).json({ error: 'Invalid specialization' });
      }
      params.push(req.body.specialization || null); sets.push(`specialization = $${params.length}`);
      changes.specialization = { from: before.specialization, to: req.body.specialization || null };
    }
    if (typeof req.body.can_view_resident_phone === 'boolean') {
      params.push(req.body.can_view_resident_phone); sets.push(`can_view_resident_phone = $${params.length}`);
      changes.can_view_resident_phone = { from: before.can_view_resident_phone, to: req.body.can_view_resident_phone };
    }
    if (typeof req.body.can_assign_requests === 'boolean') {
      params.push(req.body.can_assign_requests); sets.push(`can_assign_requests = $${params.length}`);
      changes.can_assign_requests = { from: before.can_assign_requests, to: req.body.can_assign_requests };
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE staff_users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    auditLog(req, { action: 'staff.updated', resourceId: rows[0].id, changes });
    res.json({ staff: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'email already exists for this property' });
    next(err);
  }
});

// POST /api/v1/staff/:id/deactivate
router.post('/:id/deactivate', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });
    const { rows } = await db.query(
      `UPDATE staff_users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
    auditLog(req, { action: 'staff.deactivated', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.ROLE_CAPABILITY_DEFAULTS = ROLE_CAPABILITY_DEFAULTS;
