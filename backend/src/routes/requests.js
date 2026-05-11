/**
 * routes/requests.js — FIX [A3]: тонкий HTTP-слой.
 * Бизнес-логика вынесена в services/RequestsService.js.
 * Здесь только: парсинг req → вызов сервиса → формирование res.
 */

'use strict';
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const requireAuth = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const db = require('../db');
const { broadcastRequestUpdate } = require('../sse');
const { RequestsService, ServiceError, ConflictError } = require('../services/RequestsService');
const {
  listEmergencyQueue,
  recordEmergencyDispatchAction,
} = require('../services/requests/EmergencyDispatchService');
const { RequestSlaService } = require('../services/requests/RequestSlaService');
const { RequestUpdatesService } = require('../services/requests/RequestUpdatesService');
const { dispatch: notifyDispatch } = require('../services/notificationService');
const { createSkudAdapter } = require('../services/skud');
const logger = require('../logger');

// SEC-03: per-user rate limit на создание заявок.
// Предотвращает спам-создание пропусков — без этого один пользователь может
// создать тысячи заявок, перегрузив интерфейс охраны.
const createRequestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 20,              // не более 20 заявок в минуту с одного аккаунта
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Слишком много заявок. Попробуйте через минуту.' },
  skip: (req) => req.user?.role === 'admin', // администратор без ограничений
});

const router = express.Router();
router.use(requireAuth);

const getDb = (req) => req.db || db;
const getTxPool = (req) => (typeof req.db?.connect === 'function' ? req.db : db.pool);
const getPropertyId = (req) => req.property?.id || req.body?.propertyId || req.query?.propertyId || null;

// FIX: поддерживаем и UUID, и legacy/string id (например "req-123"),
// чтобы не ломать существующие данные/тесты, но всё ещё отсеивать мусор.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function validateId(req, res, next) {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id) && !SAFE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid id format' });
  }
  next();
}

function handleServiceError(err, res, next) {
  if (err instanceof ConflictError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }
  if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
  next(err);
}

// ─── GET /api/requests/categories ────────────────────────────────────────────
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await RequestsService.listCategories(getDb(req), {
      propertyId: getPropertyId(req),
    });
    res.json({ data: categories });
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── PUT /api/requests/categories/:code ──────────────────────────────────────
router.put('/categories/:code', async (req, res, next) => {
  try {
    const category = await RequestsService.upsertCategory(
      req.user,
      getDb(req),
      getPropertyId(req),
      req.params.code,
      req.body,
    );
    res.json(category);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id/attachments ───────────────────────────────────────
router.get('/:id/attachments', validateId, async (req, res, next) => {
  try {
    const data = await RequestUpdatesService.listAttachments(req.user, req.params.id, getDb(req));
    res.json({ data });
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests/:id/attachments ──────────────────────────────────────
router.post('/:id/attachments', validateId, async (req, res, next) => {
  try {
    const attachment = await RequestUpdatesService.createAttachment(req.user, req.params.id, req.body, getDb(req));
    res.status(201).json(attachment);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id/updates ───────────────────────────────────────────
router.get('/:id/updates', validateId, async (req, res, next) => {
  try {
    const data = await RequestUpdatesService.listUpdates(req.user, req.params.id, getDb(req));
    res.json({ data });
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests/:id/updates ──────────────────────────────────────────
router.post('/:id/updates', validateId, async (req, res, next) => {
  try {
    const update = await RequestUpdatesService.createUpdate(req.user, req.params.id, req.body, getDb(req));
    res.status(201).json(update);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests/:id/assign ───────────────────────────────────────────
router.post('/:id/assign', validateId, async (req, res, next) => {
  try {
    const request = await RequestSlaService.assignRequest(req.user, req.params.id, req.body, getDb(req));
    res.json(request);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests/:id/first-response ───────────────────────────────────
router.post('/:id/first-response', validateId, async (req, res, next) => {
  try {
    const request = await RequestSlaService.markFirstResponse(req.user, req.params.id, getDb(req));
    res.json(request);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/emergency/queue ───────────────────────────────────────
router.get('/emergency/queue', async (req, res, next) => {
  try {
    res.json(await listEmergencyQueue(req.user, getDb(req), req.query));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests/:id/emergency-dispatch ───────────────────────────────
router.post('/:id/emergency-dispatch', validateId, async (req, res, next) => {
  try {
    const profile = await recordEmergencyDispatchAction(req.user, req.params.id, req.body, getDb(req));
    res.json({ emergencyProfile: profile });
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id ────────────────────────────────────────────────────
// Ownership check внутри RequestsService.getOne:
//   - Жилец получает 404 если заявка чужая (а не 403, чтобы не раскрывать факт существования)
//   - Персонал и админ видят любую заявку
router.get('/:id', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.getOne(req.user, req.params.id, getDb(req)));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    res.json(await RequestsService.list(req.user, { page, limit }, getDb(req)));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests ──────────────────────────────────────────────────────
// FIX [D1]: idempotency middleware prevents duplicate creation on retry
// SEC-03: createRequestLimiter — per-user rate limit 20/min
router.post('/', createRequestLimiter, idempotency, async (req, res, next) => {
  try {
    const created = await RequestsService.create(req.user, req.body, getDb(req), {
      propertyId: getPropertyId(req),
    });
    broadcastRequestUpdate(created);
    res.status(201).json(created);
    if (created.emergencyProfile) {
      setImmediate(() => {
        Promise.resolve(notifyDispatch(
          'request.emergency_created',
          {
            requestId: created.id,
            requestType: created.type,
            category: created.category,
            emergencyType: created.emergencyProfile.emergencyType,
            severity: created.emergencyProfile.severity,
            escalationTarget: created.emergencyProfile.escalationTarget,
            dueAt: created.emergencyProfile.firstResponseDueAt,
          },
          getDb(req),
          req.property || null,
        )).catch(() => {});
      });
    }
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── PATCH /api/requests/:id ─────────────────────────────────────────────────
router.patch('/:id', validateId, async (req, res, next) => {
  try {
    const updated = await RequestsService.update(req.user, req.params.id, req.body, getDb(req), getTxPool(req));
    broadcastRequestUpdate(updated);
    res.json(updated);

    // Dispatch push notifications for status transitions (non-blocking, fire-and-forget).
    // Notification failures must never affect the response already sent.
    const newStatus = req.body.status;
    if (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'completed') {
      const db = req.db || null;
      if (db) {
        const eventName = newStatus === 'approved'
          ? 'request.approved'
          : newStatus === 'rejected'
            ? 'request.rejected'
            : 'request.completed';
        const requestSummary = updated.visitorName
          ? `Заявка для ${updated.visitorName}`
          : `Заявка #${updated.id.slice(0, 8)}`;
        notifyDispatch(
          eventName,
          { userId: updated.createdByUid, requestId: updated.id, requestSummary },
          db,
          req.property || null,
        ).catch(() => {}); // already swallowed inside dispatch, belt-and-suspenders
      }
    }

    // QR pass auto-creation on approval (Phase 2).
    // Wrapped in try/catch — never breaks the main response.
    if (newStatus === 'approved') {
      const db = req.db || null;
      if (db) {
        try {
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = updated.validUntil
            ? new Date(updated.validUntil)
            : new Date(Date.now() + 86400000);
          await db.query(
            `INSERT INTO qr_passes (request_id, token, expires_at)
             VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [updated.id, token, expiresAt],
          );
        } catch (_passErr) {
          // Non-fatal: QR pass creation failure does not affect the response.
        }
      }

      // SKUD integration — addAccess on approval (Phase 5).
      // Fire-and-forget: a SKUD failure must never break the approval response.
      const skud = createSkudAdapter(req.property || null);
      if (skud) {
        const visitorName = updated.visitorName || updated.createdByName || 'Visitor';
        const validUntil  = updated.validUntil ? new Date(updated.validUntil) : null;
        skud.addAccess(updated.id, { name: visitorName, validUntil })
          .catch((err) => logger.warn({ err: err.message, requestId: updated.id }, '[skud] addAccess failed'));
      }
    }

    // SKUD integration — removeAccess on rejection/expiry (Phase 5).
    if (newStatus === 'rejected' || newStatus === 'expired') {
      const skud = createSkudAdapter(req.property || null);
      if (skud) {
        skud.removeAccess(updated.id)
          .catch((err) => logger.warn({ err: err.message, requestId: updated.id }, '[skud] removeAccess failed'));
      }
    }
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── DELETE /api/requests/:id ────────────────────────────────────────────────
// FIX [BUG]: добавлен broadcastRequestUpdate при soft-delete.
// Без него клиенты (охрана, консьерж) видели удалённые заявки до следующего
// переподключения SSE или перезагрузки страницы.
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const result = await RequestsService.delete(req.user, req.params.id, getDb(req));
    broadcastRequestUpdate({ id: req.params.id, status: 'deleted', deletedAt: new Date().toISOString() });
    res.json(result);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id/history ───────────────────────────────────────────
// FIX [SECURITY]: передаём req.user для проверки владения (см. RequestsService.getHistory)
router.get('/:id/history', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.getHistory(req.user, req.params.id, getDb(req)));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/v1/requests/:id/rate ──────────────────────────────────────────
// Submit a post-completion rating. Only the request creator can rate;
// the request must be 'completed' and not yet rated.
router.post('/:id/rate', validateId, async (req, res, next) => {
  try {
    const db  = req.db;
    const uid = req.user.uid;
    const id  = req.params.id;

    const { rating, comment } = req.body;

    // Validate rating
    const ratingNum = Number.parseInt(rating, 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: { code: 'INVALID_RATING', message: 'rating must be an integer between 1 and 5' } });
    }

    // Load the request — verify ownership, status, and not-yet-rated
    const { rows } = await db.query(
      `SELECT id, status, created_by_uid, rating FROM requests WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
    }

    const req_ = rows[0];

    if (req_.created_by_uid !== uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the request creator can rate it' } });
    }
    if (req_.status !== 'completed') {
      return res.status(400).json({ error: { code: 'NOT_COMPLETED', message: 'Request must be completed before rating' } });
    }
    if (req_.rating !== null) {
      return res.status(409).json({ error: { code: 'ALREADY_RATED', message: 'This request has already been rated' } });
    }

    const { rows: updated } = await db.query(
      `UPDATE requests
         SET rating=$1, rating_comment=$2, rated_at=NOW()
       WHERE id=$3
       RETURNING id, rating, rating_comment, rated_at`,
      [ratingNum, comment || null, id],
    );

    return res.json({ ok: true, rating: updated[0] });
  } catch (err) { next(err); }
});

module.exports = router;
