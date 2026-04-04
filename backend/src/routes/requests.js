/**
 * routes/requests.js — FIX [A3]: тонкий HTTP-слой.
 * Бизнес-логика вынесена в services/RequestsService.js.
 * Здесь только: парсинг req → вызов сервиса → формирование res.
 */

'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const requireAuth = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const { broadcastRequestUpdate } = require('../sse');
const { RequestsService, ServiceError } = require('../services/RequestsService');

// SEC-03: per-user rate limit на создание заявок.
// Предотвращает спам-создание пропусков — без этого один пользователь может
// создать тысячи заявок, перегрузив интерфейс охраны.
const createRequestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 20,              // не более 20 заявок в минуту с одного аккаунта
  keyGenerator: (req) => req.user?.uid || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Слишком много заявок. Попробуйте через минуту.' },
  skip: (req) => req.user?.role === 'admin', // администратор без ограничений
});

const router = express.Router();
router.use(requireAuth);

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
  if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
  next(err);
}

// ─── GET /api/requests/:id ────────────────────────────────────────────────────
// Ownership check внутри RequestsService.getOne:
//   - Жилец получает 404 если заявка чужая (а не 403, чтобы не раскрывать факт существования)
//   - Персонал и админ видят любую заявку
router.get('/:id', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.getOne(req.user, req.params.id));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    res.json(await RequestsService.list(req.user, { page, limit }));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── POST /api/requests ──────────────────────────────────────────────────────
// FIX [D1]: idempotency middleware prevents duplicate creation on retry
// SEC-03: createRequestLimiter — per-user rate limit 20/min
router.post('/', createRequestLimiter, idempotency, async (req, res, next) => {
  try {
    const created = await RequestsService.create(req.user, req.body);
    broadcastRequestUpdate(created);
    res.status(201).json(created);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── PATCH /api/requests/:id ─────────────────────────────────────────────────
router.patch('/:id', validateId, async (req, res, next) => {
  try {
    const updated = await RequestsService.update(req.user, req.params.id, req.body);
    broadcastRequestUpdate(updated);
    res.json(updated);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── DELETE /api/requests/:id ────────────────────────────────────────────────
// FIX [BUG]: добавлен broadcastRequestUpdate при soft-delete.
// Без него клиенты (охрана, консьерж) видели удалённые заявки до следующего
// переподключения SSE или перезагрузки страницы.
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const result = await RequestsService.delete(req.user, req.params.id);
    broadcastRequestUpdate({ id: req.params.id, status: 'deleted', deletedAt: new Date().toISOString() });
    res.json(result);
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id/history ───────────────────────────────────────────
// FIX [SECURITY]: передаём req.user для проверки владения (см. RequestsService.getHistory)
router.get('/:id/history', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.getHistory(req.user, req.params.id));
  } catch (err) { handleServiceError(err, res, next); }
});

module.exports = router;
