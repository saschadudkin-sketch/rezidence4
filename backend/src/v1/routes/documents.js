'use strict';

// platform-v1 documents_v2 HTTP router — Spec: documents-v2-spec.md §3.
//
// Endpoints:
//   GET    /api/v1/documents                     (resident|staff)       list
//   GET    /api/v1/documents/:id                 (resident|staff)       row
//   GET    /api/v1/public/:slug/documents        (no auth)              public list
//   POST   /api/v1/documents                     (concierge|admin)      create
//   PATCH  /api/v1/documents/:id                 (concierge|admin)      update + snapshot
//   POST   /api/v1/documents/:id/publish         (concierge|admin)      publish
//   POST   /api/v1/documents/:id/unpublish       (admin)                unpublish
//   DELETE /api/v1/documents/:id                 (admin)                soft-delete
//   GET    /api/v1/admin/documents/:id/versions          (admin)        list versions
//   GET    /api/v1/admin/documents/:id/versions/:version (admin)        version detail
//
// Capability matrix (§3):
//   security     — GET only
//   resident     — GET published/public
//   concierge    — GET + write в contacts/instructions только (service enforced)
//   admin        — всё, включая versions history
//
// v1 router mount'ится в registerApiRoutes ПЕРЕД legacy routes/documents.js —
// v1 endpoints перехватывают всё что реализовано здесь.
//
// Rate-limits:
//   POST /documents          — 20/hour per-staff
//   public list              — 60/min/IP (kiosk scale)

const express = require('express');
// express-rate-limit v6/v7: default export = function; v8: named export.
const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.rateLimit || rateLimitModule;
const ipKeyGenerator = rateLimitModule.ipKeyGenerator || ((ip) => String(ip || ''));
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const {
  FINAL_ROLES,
  isAdmin,
  isResidentUser,
  normalizeRole,
  requireCapability,
} = require('../lib/authz');
const {
  listForResident,
  listForStaff,
  listPublic,
  getById,
  createDocument,
  updateDocument,
  publishDocument,
  unpublishDocument,
  softDeleteDocument,
  listVersions,
  getVersion,
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
  resolvePropertyIdByResidentUid,
  ALLOWED_CATEGORIES,
  PUBLIC_CATEGORIES,
} = require('../services/documents');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Shim: legacy callsites ожидают `isResident(req)`; в authz переименован в isResidentUser.
const isResident = isResidentUser;

function documentRole(req) {
  return normalizeRole(req.user?.role);
}

function isDocumentReader(req) {
  const role = documentRole(req);
  return role === FINAL_ROLES.SECURITY
    || role === FINAL_ROLES.CONCIERGE
    || isAdmin(req);
}

function isDocumentWriter(req) {
  const role = documentRole(req);
  return role === FINAL_ROLES.CONCIERGE || isAdmin(req);
}

// ─── Rate limiters ──────────────────────────────────────────────────────────

const createLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.uid || ipKeyGenerator(req.ip)),
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Лимит документов — 20 в час.' } },
});

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Слишком много запросов.' } },
});

// ─── Audit ──────────────────────────────────────────────────────────────────
function audit(req, action, resourceId, changes) {
  const auditDb = req.db || db;
  auditDb.query(
    `INSERT INTO property_audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'document',$4,$5,$6)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/documents] audit write failed'));
}

// ═══════════════════════════════════════════════════════════════════════════
// Main router — requires auth.
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/v1/documents ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!isResident(req) && !isDocumentReader(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const pool = req.db || db.pool;
  try {
    if (isResident(req)) {
      const propertyId = await resolvePropertyIdByResidentUid(pool, req.user.uid);
      if (!propertyId) {
        return res.json({ ok: true, documents: [], count: 0 });
      }
      const { rows, count } = await listForResident(pool, propertyId, {
        category: req.query.category,
        tag: req.query.tag,
        limit: req.query.limit,
      });
      return res.json({ ok: true, documents: rows, count });
    }
    // Staff: требует explicit property_id.
    const propertyId = req.query.property_id;
    if (!propertyId || !isValidUuid(propertyId)) {
      return res.status(400).json({ error: 'property_id query param required for staff (UUID)' });
    }
    const { rows, count } = await listForStaff(pool, propertyId, {
      category: req.query.category,
      tag: req.query.tag,
      limit: req.query.limit,
      includeDraft: req.query.include_draft === '1' || req.query.include_draft === 'true',
      includeDeleted: req.query.include_deleted === '1' || req.query.include_deleted === 'true',
    });
    return res.json({ ok: true, documents: rows, count });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/documents] list failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/documents/:id ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const row = await getById(pool, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.deleted_at) return res.status(404).json({ error: 'Not found' });

    // Staff видит всё (кроме soft-deleted).
    if (isDocumentReader(req)) {
      return res.json({ ok: true, document: row });
    }
    // Resident — только published + в пределах своего property.
    if (!isResident(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!row.published_at) return res.status(404).json({ error: 'Not found' });
    const myProperty = await resolvePropertyIdByResidentUid(pool, req.user.uid);
    if (!myProperty || myProperty !== row.property_id) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ ok: true, document: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/documents] get failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/documents ─────────────────────────────────────────────────
// Idempotency: optional Idempotency-Key — защита от double-tap при загрузке
// документа из admin UI.
router.post('/', createLimiter, idempotency, async (req, res) => {
  if (!isDocumentWriter(req)) return res.status(403).json({ error: 'Concierge or admin required' });
  const pool = req.db || db.pool;
  const b = req.body || {};
  if (!b.property_id) return res.status(400).json({ error: 'property_id required' });

  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    if (!staffId) {
      return res.status(400).json({ error: 'staff user not registered in staff_users' });
    }
    const row = await createDocument(
      pool,
      {
        propertyId: b.property_id,
        title: b.title,
        category: b.category,
        tag: b.tag || null,
        bodyMd: b.body_md || null,
        fileUrl: b.file_url || null,
        fileMime: b.file_mime || null,
        fileSizeBytes: b.file_size_bytes,
        isPublic: Boolean(b.is_public),
        sortOrder: b.sort_order || 0,
        createdByStaffId: staffId,
      },
      {
        role: req.user.role,
        publishNow: b.publish_now === true,
      },
    );
    audit(req, 'document.created', row.id, {
      category: row.category,
      tag: row.tag,
      published: row.published_at !== null,
    });
    return res.status(201).json({ ok: true, document: row });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/documents] create failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── PATCH /api/v1/documents/:id ────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  if (!isDocumentWriter(req)) return res.status(403).json({ error: 'Concierge or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  const b = req.body || {};

  // http → js key-map
  const patch = {};
  const keyMap = [
    ['title', 'title'],
    ['category', 'category'],
    ['tag', 'tag'],
    ['body_md', 'bodyMd'],
    ['file_url', 'fileUrl'],
    ['file_mime', 'fileMime'],
    ['file_size_bytes', 'fileSizeBytes'],
    ['is_public', 'isPublic'],
    ['sort_order', 'sortOrder'],
  ];
  for (const [httpKey, jsKey] of keyMap) {
    if (httpKey in b) patch[jsKey] = b[httpKey];
  }

  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    const { row, conflict } = await updateDocument(pool, req.params.id, patch, {
      role: req.user.role,
      updatedByStaffId: staffId,
      reason: b.reason || null,
    });
    if (conflict === 'noop') return res.status(400).json({ error: 'No fields to update' });
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
    audit(req, 'document.updated', req.params.id, Object.keys(patch));
    return res.json({ ok: true, document: row });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err, id: req.params.id }, '[v1/documents] update failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/documents/:id/publish ─────────────────────────────────────
router.post('/:id/publish', async (req, res) => {
  if (!isDocumentWriter(req)) return res.status(403).json({ error: 'Concierge or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    const { row, conflict } = await publishDocument(pool, req.params.id, {
      role: req.user.role,
      updatedByStaffId: staffId,
    });
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
    // already_published — idempotent 200 per §3.
    if (conflict === 'already_published') {
      return res.json({ ok: true, document: row, idempotent: true });
    }
    audit(req, 'document.published', row.id, { category: row.category });
    return res.json({ ok: true, document: row });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err, id: req.params.id }, '[v1/documents] publish failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/documents/:id/unpublish (admin only) ──────────────────────
router.post('/:id/unpublish',
  requireCapability('documents:archive', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    const { row, conflict } = await unpublishDocument(pool, req.params.id, {
      updatedByStaffId: staffId,
    });
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'not_published') {
      return res.status(409).json({ error: 'Not published — nothing to unpublish' });
    }
    audit(req, 'document.unpublished', req.params.id, null);
    return res.json({ ok: true, document: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/documents] unpublish failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── DELETE /api/v1/documents/:id (admin only, soft) ────────────────────────
router.delete('/:id',
  requireCapability('documents:delete', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { row, conflict } = await softDeleteDocument(pool, req.params.id);
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'already_deleted') {
      return res.status(409).json({ error: 'Already deleted' });
    }
    audit(req, 'document.deleted', req.params.id, null);
    return res.json({ ok: true, document: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/documents] delete failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin sub-router — /api/v1/admin/documents.
//   GET /:id/versions             — history list
//   GET /:id/versions/:version    — single snapshot
// ═══════════════════════════════════════════════════════════════════════════

const adminRouter = express.Router();
adminRouter.use(requireAuth);

adminRouter.get('/:id/versions',
  requireCapability('documents:archive', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    // Убедимся, что документ существует (даже если deleted).
    const doc = await getById(pool, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const { rows, count } = await listVersions(pool, req.params.id);
    return res.json({ ok: true, versions: rows, count });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/admin/documents] versions list failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

adminRouter.get('/:id/versions/:version',
  requireCapability('documents:archive', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const v = Number.parseInt(req.params.version, 10);
  if (!Number.isFinite(v) || v < 1) return res.status(400).json({ error: 'Invalid version' });
  const pool = req.db || db.pool;
  try {
    const doc = await getById(pool, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const snap = await getVersion(pool, req.params.id, v);
    if (!snap) return res.status(404).json({ error: 'Version not found' });
    return res.json({ ok: true, version: snap });
  } catch (err) {
    logger.error({ err, id: req.params.id, v }, '[v1/admin/documents] version get failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Public sub-router — /api/v1/public/:slug/documents  (no auth).
// ═══════════════════════════════════════════════════════════════════════════

const publicRouter = express.Router({ mergeParams: true });

publicRouter.get('/', publicLimiter, async (req, res) => {
  const slug = req.params.slug || req.params.property_slug;
  if (!slug || typeof slug !== 'string' || slug.length > 100) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  const pool = req.db || db.pool;
  try {
    const propertyId = req.property?.id || req.property?.property_id || await resolvePropertyIdBySlug(pool, slug);
    if (!propertyId) return res.status(404).json({ error: 'Property not found' });
    const { rows, count } = await listPublic(pool, propertyId, { limit: req.query.limit });
    return res.json({ ok: true, documents: rows, count });
  } catch (err) {
    logger.error({ err, slug }, '[v1/public/documents] query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Exports — mount'аем 3 router'а отдельно в registerApiRoutes.
// ═══════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.publicRouter = publicRouter;
