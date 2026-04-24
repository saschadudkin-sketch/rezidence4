'use strict';

// platform-v1 announcements_v2 HTTP router — Spec: announcements-v2-spec.md §4.
//
// Endpoints:
//   GET    /api/v1/announcements                 (resident)             feed
//   GET    /api/v1/announcements/:id             (resident own | staff) row
//   GET    /api/v1/admin/announcements           (staff, admin)         admin list
//   GET    /api/v1/public/:slug/announcements    (no auth)              kiosk
//   POST   /api/v1/announcements                 (concierge, admin)     draft
//   PATCH  /api/v1/announcements/:id             (concierge, admin)     draft only
//   POST   /api/v1/announcements/:id/publish     (concierge non-urgent | admin) publish
//   POST   /api/v1/announcements/:id/unpublish   (admin)                unpublish
//   DELETE /api/v1/announcements/:id             (admin)                soft-delete
//   GET    /api/v1/admin/announcements/:id/metrics (admin)              reach
//
// Маршруты НЕ имеют шиммов /api/announcements — v1 is source of truth per
// CLAUDE.md.  Legacy announcements router (src/routes/announcements.js)
// остаётся как fallthrough для endpoint'ов, которые v1 ещё не покрыл;
// v1 router mount'ится ПЕРЕД legacy, чтобы перехватывать.
//
// Capability matrix (§4):
//   security     — GET only
//   concierge    — GET, POST draft, PATCH, publish (non-urgent only)
//   admin        — всё
//   resident     — GET feed + GET :id (own-visibility)
//
// Rate-limits (§4):
//   POST /announcements        — 10/hour per-staff
//   POST /:id/publish (urgent) — 5/hour per-property

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../db');
const logger = require('../../logger');
const requireAuth = require('../../middleware/auth');
const {
  isAdmin,
  isStaffOrAdmin,
  isResidentUser,
  requireCapability,
} = require('../lib/authz');
const {
  listForResident,
  listForAdmin,
  listPublic,
  getById,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
  softDeleteAnnouncement,
  getReachMetrics,
  resolveResidentContextByUid,
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
  ALLOWED_CHANNELS,
  ALLOWED_CATEGORIES,
  ALLOWED_AUDIENCE_TYPES,
} = require('../services/announcements');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
// Role предикаты — shim под legacy call-sites (name isResident → isResidentUser из authz).
const isResident = isResidentUser;

// ─── Rate limiters (§4) ──────────────────────────────────────────────────────
const createLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.uid || req.ip),
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Лимит объявлений — 10 в час.' } },
});

// 5/hour per-property для urgent publish — ключом IP мы НЕ можем, потому что
// publish — это один endpoint для urgent/non-urgent, а мы различаем по body
// объявления, до лимита.  Ключ: `${propertyId}:urgent`; но propertyId тоже
// нужно получить из БД.  Компромисс: ключ — user + `urgent`, который срабатывает
// per-staff-per-hour (разумная проксия на property scope для одного объекта).
const urgentPublishLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.uid || req.ip}:urgent`,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Лимит срочных объявлений — 5 в час.' } },
});

// Public kiosk endpoint — отдельный per-IP лимитер.
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Слишком много запросов.' } },
});

// ─── Audit ──────────────────────────────────────────────────────────────────
function audit(req, action, resourceId, changes) {
  // SEC [AUDIT #1]: audit остаётся на singleton db.query (не req.db).
  //   • Single-tenant go-live: DATABASE_URL === tenant DB → корректно.
  //   • Multi-tenant post-launch: TODO — мигрировать на req.db, когда подключён
  //     второй property и надо гарантировать tenant-isolated audit_log.
  db.query(
    `INSERT INTO property_audit_log
       (actor_uid, actor_role, action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'announcement',$4,$5,$6)`,
    [
      req.user?.uid || null,
      req.user?.role || null,
      action,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      req.ip || null,
    ],
  ).catch((err) => logger.warn({ err, action }, '[v1/announcements] audit write failed'));
}

// ═══════════════════════════════════════════════════════════════════════════
// Main router — requires auth (mounted BEFORE public router).
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/v1/announcements (resident feed) ──────────────────────────────
router.get('/', async (req, res) => {
  // Staff тоже может читать feed — но мы отдаём admin feed в отдельной ручке;
  // для staff /announcements возвращает «как увидит обычный резидент его
  // объекта» — что не имеет смысла.  Поэтому 403 staff → пусть идут в /admin.
  if (!isResident(req) && !isStaffOrAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const pool = req.db || db.pool;
  try {
    if (isResident(req)) {
      const ctx = await resolveResidentContextByUid(pool, req.user.uid);
      if (!ctx) return res.json({ ok: true, announcements: [], count: 0 });
      const { rows, count } = await listForResident(pool, ctx, {
        category: req.query.category,
        onlyActive: req.query.only_active !== 'false',
        limit: req.query.limit,
      });
      return res.json({ ok: true, announcements: rows, count });
    }
    // Staff viewing /announcements — показываем «live» feed объекта staff'а.
    // Для простоты v1: возвращаем пустой список и подсказываем /admin.
    return res.json({
      ok: true,
      announcements: [],
      count: 0,
      hint: 'staff should use /api/v1/admin/announcements',
    });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/announcements] feed query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/v1/announcements/:id (resident own | staff) ───────────────────
router.get('/:id', async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const row = await getById(pool, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.deleted_at) return res.status(404).json({ error: 'Not found' });

    // Staff видит всё.  Резидент — только опубликованное и попадающее в
    // audience (+ временное окно).
    if (!isStaffOrAdmin(req)) {
      if (!isResident(req)) return res.status(403).json({ error: 'Forbidden' });
      if (!row.published_at) return res.status(404).json({ error: 'Not found' });
      const ctx = await resolveResidentContextByUid(pool, req.user.uid);
      if (!ctx) return res.status(404).json({ error: 'Not found' });
      if (!residentMatchesAudience(ctx, row)) {
        return res.status(404).json({ error: 'Not found' });
      }
      // Временное окно.
      const now = Date.now();
      if (new Date(row.starts_at).getTime() > now) return res.status(404).json({ error: 'Not found' });
      if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
        return res.status(404).json({ error: 'Not found' });
      }
    }
    return res.json({ ok: true, announcement: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/announcements] get failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/announcements (concierge, admin) ──────────────────────────
router.post('/', createLimiter, async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  const pool = req.db || db.pool;
  const b = req.body || {};

  if (!b.property_id) return res.status(400).json({ error: 'property_id required' });

  try {
    const staffId = await resolveStaffIdByUid(pool, req.user.uid);
    if (!staffId) {
      return res.status(400).json({ error: 'staff user not registered in staff_users' });
    }
    const row = await createAnnouncement(pool, {
      propertyId: b.property_id,
      title: b.title,
      bodyMd: b.body_md,
      isUrgent: Boolean(b.is_urgent),
      category: b.category,
      audienceType: b.audience_type,
      audienceBuildingId: b.audience_building_id || null,
      audienceEntranceId: b.audience_entrance_id || null,
      audienceUnitType: b.audience_unit_type || null,
      startsAt: b.starts_at || null,
      expiresAt: b.expires_at || null,
      isPinned: Boolean(b.is_pinned),
      notifyChannels: b.notify_channels || ['web_push'],
      createdByStaffId: staffId,
    });
    audit(req, 'announcement.created', row.id, {
      category: row.category,
      audience_type: row.audience_type,
      is_urgent: row.is_urgent,
    });
    return res.status(201).json({ ok: true, announcement: row });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/announcements] create failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── PATCH /api/v1/announcements/:id (drafts only) ──────────────────────────
router.patch('/:id', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  const b = req.body || {};

  // Собираем patch только с известных ключей (остальное игнорируем).
  const patch = {};
  const keyMap = [
    ['title', 'title'],
    ['body_md', 'bodyMd'],
    ['is_urgent', 'isUrgent'],
    ['category', 'category'],
    ['audience_type', 'audienceType'],
    ['audience_building_id', 'audienceBuildingId'],
    ['audience_entrance_id', 'audienceEntranceId'],
    ['audience_unit_type', 'audienceUnitType'],
    ['starts_at', 'startsAt'],
    ['expires_at', 'expiresAt'],
    ['is_pinned', 'isPinned'],
    ['notify_channels', 'notifyChannels'],
  ];
  for (const [httpKey, jsKey] of keyMap) {
    if (httpKey in b) patch[jsKey] = b[httpKey];
  }

  try {
    const { row, conflict } = await updateAnnouncement(pool, req.params.id, patch);
    if (conflict === 'noop') return res.status(400).json({ error: 'No fields to update' });
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'already_published') {
      return res.status(409).json({ error: 'Cannot edit after publish. Create new announcement instead.' });
    }
    audit(req, 'announcement.updated', req.params.id, Object.keys(patch));
    return res.json({ ok: true, announcement: row });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err, id: req.params.id }, '[v1/announcements] update failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/announcements/:id/publish ─────────────────────────────────
// RBAC гейтится за двумя лимитерами: base (staff/admin) vs urgent (admin only).
// Поскольку в body приходит is_urgent и мы гейтим по нему, но body ещё не
// прочитан к моменту проверки лимитов — применяем limiter'ы ветвями.
router.post('/:id/publish', async (req, res, next) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

  // Pre-read row, чтобы определить is_urgent и применить правильный RBAC.
  const pool = req.db || db.pool;
  try {
    const existing = await getById(pool, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.deleted_at) return res.status(404).json({ error: 'Not found' });

    if (existing.is_urgent && !isAdmin(req)) {
      return res.status(403).json({ error: 'Admin only for urgent announcements' });
    }

    // Rate-limit: urgent → urgentPublishLimiter (5/hour).  Non-urgent
    // проходит без дополнительного rate-limit (create'овский уже отсёк).
    const limiter = existing.is_urgent ? urgentPublishLimiter : (_req, _res, cb) => cb();
    limiter(req, res, async (err) => {
      if (err) return next(err);
      if (res.headersSent) return; // limiter завершил 429.

      try {
        const staffId = await resolveStaffIdByUid(pool, req.user.uid);
        if (!staffId) {
          return res.status(400).json({ error: 'staff user not registered in staff_users' });
        }
        const { row, outboxRows, conflict } = await publishAnnouncement(pool, req.params.id, staffId);
        if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
        if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
        if (conflict === 'already_published') {
          return res.status(409).json({ error: 'Already published' });
        }
        audit(req, 'announcement.published', row.id, {
          is_urgent: row.is_urgent,
          audience_type: row.audience_type,
          outbox_fanout: outboxRows.length,
        });
        return res.json({ ok: true, announcement: row, outbox_fanout: outboxRows.length });
      } catch (err2) {
        if (/^invalid /i.test(err2.message)) {
          return res.status(400).json({ error: err2.message });
        }
        logger.error({ err: err2, id: req.params.id }, '[v1/announcements] publish failed');
        return res.status(503).json({ ok: false, error: err2.message });
      }
    });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/announcements] publish pre-check failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/v1/announcements/:id/unpublish (admin only) ──────────────────
router.post('/:id/unpublish',
  requireCapability('announcements:unpublish_urgent', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { row, conflict } = await unpublishAnnouncement(pool, req.params.id);
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'deleted') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'not_published') {
      return res.status(409).json({ error: 'Not published — nothing to unpublish' });
    }
    audit(req, 'announcement.unpublished', req.params.id, null);
    return res.json({ ok: true, announcement: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/announcements] unpublish failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── DELETE /api/v1/announcements/:id (admin only, soft) ────────────────────
router.delete('/:id',
  requireCapability('announcements:archive', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const { row, conflict } = await softDeleteAnnouncement(pool, req.params.id);
    if (conflict === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (conflict === 'already_deleted') {
      return res.status(409).json({ error: 'Already deleted' });
    }
    audit(req, 'announcement.deleted', req.params.id, null);
    return res.json({ ok: true, announcement: row });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/announcements] delete failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function residentMatchesAudience(ctx, row) {
  if (row.audience_type === 'all') return true;
  if (row.audience_type === 'building') return ctx.buildingId === row.audience_building_id;
  if (row.audience_type === 'entrance') return ctx.entranceId === row.audience_entrance_id;
  if (row.audience_type === 'unit_type') return ctx.residentType === row.audience_unit_type;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin sub-router — /api/v1/admin/announcements.
// ═══════════════════════════════════════════════════════════════════════════

const adminRouter = express.Router();
adminRouter.use(requireAuth);

adminRouter.get('/', async (req, res) => {
  if (!isStaffOrAdmin(req)) return res.status(403).json({ error: 'Staff or admin required' });
  const pool = req.db || db.pool;
  const propertyId = req.query.property_id;
  if (!propertyId || !isValidUuid(propertyId)) {
    return res.status(400).json({ error: 'property_id query param required (UUID)' });
  }
  try {
    const { rows, count } = await listForAdmin(pool, propertyId, {
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ ok: true, announcements: rows, count });
  } catch (err) {
    if (/^invalid /i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, '[v1/admin/announcements] list failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

adminRouter.get('/:id/metrics',
  requireCapability('announcements:publish', { message: 'Admin only' }),
  async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = req.db || db.pool;
  try {
    const metrics = await getReachMetrics(pool, req.params.id);
    if (!metrics) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, metrics });
  } catch (err) {
    logger.error({ err, id: req.params.id }, '[v1/admin/announcements] metrics failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Public sub-router — /api/v1/public/:slug/announcements (no auth).
// ═══════════════════════════════════════════════════════════════════════════

const publicRouter = express.Router({ mergeParams: true });
publicRouter.get('/', publicLimiter, async (req, res) => {
  const slug = req.params.slug || req.params.property_slug;
  if (!slug || typeof slug !== 'string' || slug.length > 100) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  const pool = req.db || db.pool;
  try {
    const propertyId = await resolvePropertyIdBySlug(pool, slug);
    if (!propertyId) return res.status(404).json({ error: 'Property not found' });
    const { rows, count } = await listPublic(pool, propertyId, { limit: req.query.limit });
    return res.json({ ok: true, announcements: rows, count });
  } catch (err) {
    logger.error({ err, slug }, '[v1/public/announcements] query failed');
    return res.status(503).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Exports — mount'аем 3 router'а отдельно в registerApiRoutes.
// ═══════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.publicRouter = publicRouter;
