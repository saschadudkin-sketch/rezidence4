/**
 * routes/requests.js — FIX [A3]: тонкий HTTP-слой.
 * Бизнес-логика вынесена в services/RequestsService.js.
 * Здесь только: парсинг req → вызов сервиса → формирование res.
 */

'use strict';
const express = require('express');
const requireAuth = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const { broadcastRequestUpdate } = require('../sse');
const { RequestsService, ServiceError } = require('../services/RequestsService');

const router = express.Router();
router.use(requireAuth);

// FIX [AUDIT-2 #22]: валидация формата UUID — мусорные id не попадают в БД/логи
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid id format' });
  }
  next();
}

function handleServiceError(err, res, next) {
  if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
  next(err);
}

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
router.post('/', idempotency, async (req, res, next) => {
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
router.delete('/:id', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.delete(req.user, req.params.id));
  } catch (err) { handleServiceError(err, res, next); }
});

// ─── GET /api/requests/:id/history ───────────────────────────────────────────
router.get('/:id/history', validateId, async (req, res, next) => {
  try {
    res.json(await RequestsService.getHistory(req.params.id));
  } catch (err) { next(err); }
});

module.exports = router;
