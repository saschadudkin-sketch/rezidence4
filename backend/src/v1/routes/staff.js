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
const { canInPropertyScope, isAdmin } = require('../lib/authz');
const { parsePaginationParams, buildPageMeta } = require('../lib/pagination');
const {
  isResourceScopeServiceError,
  loadResourcePropertyId,
} = require('../services/resourceScope');
const {
  applyStaffImport,
  buildStaffImportTemplate,
  isOnboardingImportError,
  previewStaffImport,
} = require('../services/onboardingImportService');
const {
  provisionStaffMembership,
  suspendMembershipsForSubject,
} = require('../services/roleScopeMembershipService');

const router = express.Router();
router.use(requireAuth);
const importCsvParser = express.text({
  type: ['text/csv', 'text/plain', 'application/csv'],
  limit: '1mb',
});

// SEC [AUDIT #1] — per-tenant pool, см. комментарий в structure.js.
const getDb = (req) => req.db || db;

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
function isPropertyAdmin(req, propertyId = null) {
  if (!propertyId) return isAdmin(req);
  return canInPropertyScope(req, 'staff:write', propertyId);
}
function canReadStaff(req, propertyId) {
  return canInPropertyScope(req, 'staff:read', propertyId);
}
function resolvePropertyId(req) {
  return req.query.property_id
    || req.query.propertyId
    || req.body?.property_id
    || req.body?.propertyId
    || req.property?.id
    || req.property?.property_id
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}
function sendScopeError(res, err) {
  if (!isResourceScopeServiceError(err)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

async function requirePropertyAdminForResource(req, res, resourceType, resourceId, notFoundMessage) {
  const propertyId = await loadResourcePropertyId(getDb(req), resourceType, resourceId, { notFoundMessage });
  if (!isPropertyAdmin(req, propertyId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return propertyId;
}
function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function auditLog(req, { action, resourceId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log(actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, 'staff_user', $4, $5, $6)`,
    [req.user?.uid || null, req.user?.role || null, action, resourceId, changes ? JSON.stringify(changes) : null, req.ip || null],
  ).catch((err) => logger.warn({ err, action }, '[v1/staff] audit write failed'));
}

function auditImportLog(req, { action, propertyId, changes }) {
  getDb(req).query(
    `INSERT INTO property_audit_log(actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1, $2, $3, 'onboarding_import', $4, $5, $6)`,
    [req.user?.uid || null, req.user?.role || null, action, propertyId, changes ? JSON.stringify(changes) : null, req.ip || null],
  ).catch((err) => logger.warn({ err, action }, '[v1/staff] import audit write failed'));
}

function resolveImportPropertyId(req) {
  const body = req.body;
  return (body && typeof body === 'object' && !Array.isArray(body) ? body.property_id || body.propertyId : null)
    || req.query.property_id
    || req.query.propertyId
    || req.user?.property_id
    || req.user?.propertyId
    || null;
}

function sendImportError(res, err) {
  if (!isOnboardingImportError(err)) return false;
  const body = { error: err.message };
  if (err.details) body.details = err.details;
  res.status(err.status).json(body);
  return true;
}

// GET /api/v1/staff?role=&is_active=&q=&limit=&offset=
router.get('/', async (req, res, next) => {
  try {
    const propertyId = resolvePropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!canReadStaff(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });

    let pagination;
    try {
      pagination = parsePaginationParams(req.query);
    } catch (rangeErr) {
      return res.status(400).json({ error: rangeErr.message });
    }

    const filters = ['property_id = $1'];
    const params = [propertyId];
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
    params.push(pagination.limit);
    const limitIdx = params.length;
    params.push(pagination.offset);
    const offsetIdx = params.length;

    const { rows } = await getDb(req).query(
      `SELECT * FROM staff_users ${where} ORDER BY full_name ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    res.json({
      staff: rows,
      page: buildPageMeta({ ...pagination, returnedCount: rows.length }),
    });
  } catch (err) { next(err); }
});

// GET /api/v1/staff/import/template
router.get('/import/template', async (req, res, next) => {
  try {
    if (!isPropertyAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const template = buildStaffImportTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`);
    res.send(template.content);
  } catch (err) { next(err); }
});

// POST /api/v1/staff/import/preview
router.post('/import/preview', importCsvParser, async (req, res, next) => {
  try {
    const propertyId = resolveImportPropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const preview = previewStaffImport({ body: req.body || {} });
    res.json(preview);
  } catch (err) {
    if (sendImportError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/staff/import/apply
router.post('/import/apply', importCsvParser, async (req, res, next) => {
  try {
    const propertyId = resolveImportPropertyId(req);
    if (!isValidUuid(propertyId)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const result = await applyStaffImport({
      queryable: getDb(req),
      propertyId,
      body: req.body || {},
    });
    auditImportLog(req, {
      action: 'staff.imported',
      propertyId,
      changes: {
        imported: result.imported,
        skipped: result.skipped,
        checklist: result.checklist,
      },
    });
    res.status(201).json(result);
  } catch (err) {
    if (sendImportError(res, err)) return;
    if (err && err.code === '23505') return res.status(409).json({ error: 'staff import duplicate conflict' });
    next(err);
  }
});

// GET /api/v1/staff/:id
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });
    const propertyId = await loadResourcePropertyId(getDb(req), 'staff_user', req.params.id, {
      notFoundMessage: 'Staff not found',
    });
    if (!canReadStaff(req, propertyId)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await getDb(req).query(
      `SELECT * FROM staff_users WHERE id = $1 AND property_id = $2`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
    res.json({ staff: rows[0] });
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// POST /api/v1/staff
router.post('/', async (req, res, next) => {
  try {
    const {
      property_id, full_name, email, role,
      phone = null, specialization = null, external_uid = null,
      can_view_resident_phone, can_assign_requests,
    } = req.body || {};

    if (!isValidUuid(property_id)) return res.status(400).json({ error: 'property_id must be UUID' });
    if (!isPropertyAdmin(req, property_id)) return res.status(403).json({ error: 'Forbidden' });
    if (!isNonEmptyString(full_name, 200)) return res.status(400).json({ error: 'full_name required (1–200 chars)' });
    if (!EMAIL_RE.test(String(email || ''))) return res.status(400).json({ error: 'Invalid email' });
    if (!STAFF_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' });
    if (phone !== null && phone !== undefined && phone !== '' && !PHONE_RE.test(String(phone))) {
      return res.status(400).json({ error: 'phone must be E.164-like' });
    }
    if (specialization !== null && specialization !== undefined && specialization !== '' && !SPECIALIZATIONS.has(specialization)) {
      return res.status(400).json({ error: 'Invalid specialization' });
    }
    if (external_uid !== null && external_uid !== undefined && external_uid !== '' && !isNonEmptyString(external_uid, 200)) {
      return res.status(400).json({ error: 'external_uid must be 1-200 chars or null' });
    }

    // Capability flags: caller override > role default.
    const defaults = ROLE_CAPABILITY_DEFAULTS[role];
    const effectivePhoneView = typeof can_view_resident_phone === 'boolean' ? can_view_resident_phone : defaults.can_view_resident_phone;
    const effectiveAssign = typeof can_assign_requests === 'boolean' ? can_assign_requests : defaults.can_assign_requests;

    const { rows } = await getDb(req).query(
      `INSERT INTO staff_users(
         property_id, full_name, phone, email, role, specialization,
         can_view_resident_phone, can_assign_requests, external_uid
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        property_id, full_name.trim(), phone || null, email, role,
        specialization || null, effectivePhoneView, effectiveAssign, external_uid || null,
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
    await provisionStaffMembership({
      queryable: getDb(req),
      staff: { ...rows[0], property_id: rows[0].property_id || property_id, role: rows[0].role || role },
      provisionedFrom: 'api',
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
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });

    const propertyId = await requirePropertyAdminForResource(req, res, 'staff_user', req.params.id, 'Staff not found');
    if (!propertyId) return;

    // Read current row for audit before/after inside the authorized property.
    const { rows: existing } = await getDb(req).query(
      `SELECT * FROM staff_users WHERE id = $1 AND property_id = $2`,
      [req.params.id, propertyId],
    );
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
    if (req.body.external_uid !== undefined) {
      if (req.body.external_uid !== null && req.body.external_uid !== '' && !isNonEmptyString(req.body.external_uid, 200)) {
        return res.status(400).json({ error: 'external_uid must be 1-200 chars or null' });
      }
      params.push(req.body.external_uid || null); sets.push(`external_uid = $${params.length}`);
      changes.external_uid = { from: before.external_uid || null, to: req.body.external_uid || null };
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
    const idIdx = params.length;
    params.push(before.property_id);
    const { rows } = await getDb(req).query(
      `UPDATE staff_users
          SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND property_id = $${params.length}
        RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
    auditLog(req, { action: 'staff.updated', resourceId: rows[0].id, changes });
    if (changes.role) {
      await suspendMembershipsForSubject({
        queryable: getDb(req),
        subjectType: 'staff',
        subjectId: rows[0].id,
        reason: `staff role changed from ${changes.role.from} to ${changes.role.to}`,
      });
      await provisionStaffMembership({
        queryable: getDb(req),
        staff: {
          ...rows[0],
          property_id: rows[0].property_id || before.property_id,
          role: rows[0].role || changes.role.to,
        },
        provisionedFrom: 'api',
      });
    }
    res.json({ staff: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'email already exists for this property' });
    next(err);
  }
});

// POST /api/v1/staff/:id/deactivate
router.post('/:id/deactivate', async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid staff id' });
    const propertyId = await requirePropertyAdminForResource(req, res, 'staff_user', req.params.id, 'Staff not found');
    if (!propertyId) return;
    const { rows } = await getDb(req).query(
      `UPDATE staff_users
          SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND property_id = $2
        RETURNING id`,
      [req.params.id, propertyId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
    auditLog(req, { action: 'staff.deactivated', resourceId: rows[0].id, changes: null });
    await suspendMembershipsForSubject({
      queryable: getDb(req),
      subjectType: 'staff',
      subjectId: rows[0].id,
      reason: 'staff deactivated',
    });
    res.status(204).end();
  } catch (err) {
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

module.exports = router;
module.exports.ROLE_CAPABILITY_DEFAULTS = ROLE_CAPABILITY_DEFAULTS;
