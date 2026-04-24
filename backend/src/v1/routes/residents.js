'use strict';

// platform-v1 Residents route.
// Spec: docs/product/specs/platform-v1/residents-spec.md
// Phase: 2 (People layer).
//
// Residents are read by staff and mutated by property_admin only.
// The `phone` field is blanked out for staff who lack the
// `can_view_resident_phone` capability; that capability is attached in the
// staff_users row but legacy JWT (which protects this route in Фаза 2) does
// not carry it, so for now we grant full phone visibility to legacy
// role='admin' only and hide it from 'security'/'concierge'.  When the
// capability migration lands (Фаза 3+), this helper swaps to reading the
// flag from req.subject.

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
const RESIDENT_TYPES = new Set(['owner', 'tenant', 'family_member']);
// E.164-ish: + and 8–15 digits.  We do not normalise on write — service layer
// in Фаза 3 will handle canonical form; for now we just ensure the DB gets a
// non-empty string that passes a sanity regex.
const PHONE_RE = /^\+?\d{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim: legacy имя `isPropertyAdmin` → `isAdmin` из authz.
const isPropertyAdmin = isAdmin;
function canViewPhone(req) {
  // Property admin always sees phones.  'concierge' gets phones too because
  // the spec default in staff-users-spec §3 is can_view_resident_phone=true
  // for concierges; 'security' (guards) do not.  Consistent with v1 defaults.
  // В Фазе 6+ переедет на can(req.user, 'residents:read_phone') (authz §cat),
  // но пока что JWT не несёт capability-флагов — предикат сохраняет
  // behavior-preserving role-only check.
  return req.user && (req.user.role === 'admin' || req.user.role === 'concierge');
}

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function formatResident(row, withPhone) {
  return {
    id: row.id,
    external_uid: row.external_uid,
    property_id: row.property_id,
    unit_id: row.unit_id,
    full_name: row.full_name,
    phone: withPhone ? row.phone : null,
    email: row.email,
    role: row.role,
    resident_type: row.resident_type,
    is_active: row.is_active,
    consent_given_at: row.consent_given_at,
    consent_version: row.consent_version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function auditLog(req, { action, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log(actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, 'resident', $4, $5, $6)`,
    [req.user?.uid || null, req.user?.role || null, action, resourceId, changes ? JSON.stringify(changes) : null, req.ip || null],
  ).catch((err) => logger.warn({ err, action }, '[v1/residents] audit write failed'));
}

// GET /api/v1/residents?unit_id=&q=&is_active=
router.get('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const filters = [];
    const params = [];
    if (req.query.unit_id) {
      if (!isValidUuid(req.query.unit_id)) return res.status(400).json({ error: 'Invalid unit_id' });
      params.push(req.query.unit_id); filters.push(`unit_id = $${params.length}`);
    }
    if (req.query.is_active !== undefined) {
      const active = req.query.is_active === 'true' || req.query.is_active === '1';
      params.push(active); filters.push(`is_active = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
      filters.push(`(LOWER(full_name) LIKE $${params.length} OR LOWER(COALESCE(email, '')) LIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await getDb(req).query(
      `SELECT * FROM residents ${where} ORDER BY full_name ASC LIMIT 500`,
      params,
    );
    const show = canViewPhone(req);
    res.json({ residents: rows.map((r) => formatResident(r, show)) });
  } catch (err) { next(err); }
});

// GET /api/v1/residents/:id — self + staff
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid resident id' });
    if (!isStaff(req.user.role) && req.user.uid !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await getDb(req).query(`SELECT * FROM residents WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    // Phone always visible to self, else capability-gated.
    const showPhone = req.user.uid === req.params.id || canViewPhone(req);
    res.json({ resident: formatResident(rows[0], showPhone) });
  } catch (err) { next(err); }
});

// POST /api/v1/residents — property_admin only
router.post('/', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const {
      property_id, unit_id, full_name, phone, email = null,
      resident_type = 'owner', external_uid = null,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isValidUuid(unit_id)) return res.status(400).json({ error: 'unit_id must be UUID' });
    if (!isNonEmptyString(full_name, 200)) return res.status(400).json({ error: 'full_name required (1–200 chars)' });
    if (!PHONE_RE.test(String(phone || ''))) return res.status(400).json({ error: 'phone must be E.164-like (+ and 8–15 digits)' });
    if (email !== null && email !== undefined && email !== '' && !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!RESIDENT_TYPES.has(resident_type)) return res.status(400).json({ error: 'Invalid resident_type' });

    // Pre-check unit exists and is active — otherwise the FK will still allow
    // the insert but we want a 400 with a more helpful message than a 23503.
    const { rows: unitCheck } = await getDb(req).query(
      `SELECT is_active FROM units WHERE id = $1`,
      [unit_id],
    );
    if (!unitCheck[0]) return res.status(400).json({ error: 'unit_id does not exist' });
    if (!unitCheck[0].is_active) return res.status(400).json({ error: 'Cannot attach resident to inactive unit' });

    const { rows } = await getDb(req).query(
      `INSERT INTO residents(
         external_uid, property_id, unit_id, full_name, phone, email, resident_type
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [external_uid || null, property_id, unit_id, full_name.trim(), phone, email || null, resident_type],
    );
    auditLog(req, {
      action: 'resident.created',
      resourceId: rows[0].id,
      changes: { unit_id, resident_type, has_email: !!email },
    });
    res.status(201).json({ resident: formatResident(rows[0], true) });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'external_uid already exists' });
    next(err);
  }
});

// PATCH /api/v1/residents/:id
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid resident id' });
    const self = req.user.uid === req.params.id;
    if (!isPropertyAdmin(req) && !self) return res.status(403).json({ error: 'Forbidden' });

    const changes = {};
    const sets = [];
    const params = [];

    // Self may update their own full_name/email only.  property_admin may
    // update everything structural (unit_id, resident_type, phone).
    if (req.body.full_name !== undefined) {
      if (!isNonEmptyString(req.body.full_name, 200)) return res.status(400).json({ error: 'full_name invalid' });
      params.push(req.body.full_name.trim()); sets.push(`full_name = $${params.length}`); changes.full_name = req.body.full_name.trim();
    }
    if (req.body.email !== undefined) {
      if (req.body.email !== null && !EMAIL_RE.test(String(req.body.email))) return res.status(400).json({ error: 'Invalid email' });
      params.push(req.body.email || null); sets.push(`email = $${params.length}`); changes.email = req.body.email;
    }
    if (req.body.phone !== undefined) {
      if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Only property_admin may change phone' });
      if (!PHONE_RE.test(String(req.body.phone || ''))) return res.status(400).json({ error: 'phone must be E.164-like' });
      params.push(req.body.phone); sets.push(`phone = $${params.length}`); changes.phone = req.body.phone;
    }
    if (req.body.resident_type !== undefined) {
      if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Only property_admin may change resident_type' });
      if (!RESIDENT_TYPES.has(req.body.resident_type)) return res.status(400).json({ error: 'Invalid resident_type' });
      params.push(req.body.resident_type); sets.push(`resident_type = $${params.length}`); changes.resident_type = req.body.resident_type;
    }
    if (req.body.unit_id !== undefined) {
      if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Only property_admin may change unit_id' });
      if (!isValidUuid(req.body.unit_id)) return res.status(400).json({ error: 'unit_id must be UUID' });
      params.push(req.body.unit_id); sets.push(`unit_id = $${params.length}`); changes.unit_id = req.body.unit_id;
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const { rows } = await getDb(req).query(
      `UPDATE residents SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    auditLog(req, { action: 'resident.updated', resourceId: rows[0].id, changes });
    res.json({ resident: formatResident(rows[0], canViewPhone(req) || self) });
  } catch (err) { next(err); }
});

// POST /api/v1/residents/:id/deactivate
router.post('/:id/deactivate', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid resident id' });
    const { rows } = await getDb(req).query(
      `UPDATE residents SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    auditLog(req, { action: 'resident.deactivated', resourceId: rows[0].id, changes: null });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/v1/residents/:id/consent — self only
router.post('/:id/consent', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid resident id' });
    if (req.user.uid !== req.params.id) return res.status(403).json({ error: 'Only the resident themselves may give consent' });

    const { consent_version } = req.body || {};
    if (!isNonEmptyString(consent_version, 20)) return res.status(400).json({ error: 'consent_version required' });

    const { rows } = await getDb(req).query(
      `UPDATE residents
          SET consent_given_at = NOW(), consent_version = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, consent_given_at, consent_version`,
      [consent_version, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    auditLog(req, { action: 'resident.consent_given', resourceId: rows[0].id, changes: { consent_version } });
    res.json({ resident: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
