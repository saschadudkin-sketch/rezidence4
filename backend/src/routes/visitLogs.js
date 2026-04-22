'use strict';
const express = require('express');
const { randomUUID: uuid } = require('crypto');
const db      = require('../db');
const logger  = require('../logger'); // FIX [КРИТ-2]: logger был вызван без импорта
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants'); // FIX [CODE-1]
const { dispatch: notifyDispatch } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

function fmt(r) {
  return {
    id:              r.id,
    userId:          r.user_id,
    requestId:       r.request_id,
    visitorName:     r.visitor_name,
    category:        r.category,
    carPlate:        r.car_plate,
    createdByApt:    r.created_by_apt,
    createdByName:   r.created_by_name,
    createdByUid:    r.created_by_uid,
    actorName:       r.actor_name,
    actorRole:       r.actor_role,
    result:          r.result,
    reason:          r.reason,
    requestSnapshot: r.request_snapshot,
    timestamp:       r.timestamp,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isValidVisitLogId(id) {
  return UUID_RE.test(id) || SAFE_ID_RE.test(id);
}

router.get('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // FIX [PERF-1]: пагинация — 500 строк с JSONB-снепшотами = ~2.5MB одним ответом
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    // FIX [PERF+CORRECTNESS]: window function COUNT(*) OVER() вместо двух запросов.
    // Было: два параллельных roundtrip + reltuples из pg_class (устаревает без VACUUM,
    //   может показывать 100 при 10000 реальных строках → неверная пагинация).
    // Стало: один запрос, точный COUNT, паттерн идентичен RequestsService.list().
    const { rows } = await db.query(
      `SELECT id, user_id, request_id, visitor_name, category, car_plate,
              created_by_apt, created_by_name, created_by_uid,
              actor_name, actor_role, result, reason, timestamp,
              COUNT(*) OVER() AS total_count
       FROM visit_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    res.json({
      data:  rows.map(fmt),
      total,
      page,
      limit,
    });
  } catch (err) { next(err); }
});

// FIX [AUDIT-2 #4]: валидация входных данных — защита от DoS через requestSnapshot
const ALLOWED_RESULTS = new Set(['allowed', 'denied', 'manual']);

router.post('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body;

    // Валидация
    if (b.result && !ALLOWED_RESULTS.has(b.result))
      return res.status(400).json({ error: 'Invalid result' });
    if (b.visitorName && b.visitorName.length > 200)
      return res.status(400).json({ error: 'visitorName too long' });
    if (b.requestSnapshot && JSON.stringify(b.requestSnapshot).length > 50_000)
      return res.status(400).json({ error: 'requestSnapshot too large (max 50KB)' });

    const { rows } = await db.query(
      `INSERT INTO visit_logs
         (id, user_id, request_id, visitor_name, category, car_plate,
          created_by_apt, created_by_name, created_by_uid,
          actor_name, actor_role, result, reason, request_snapshot, timestamp)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        b.id || uuid(),
        b.userId || null, b.requestId || null,
        b.visitorName || null, b.category || null, b.carPlate || null,
        b.createdByApt || null, b.createdByName || null, b.createdByUid || null,
        b.actorName || null, b.actorRole || null,
        b.result || 'allowed', b.reason || 'ok',
        b.requestSnapshot ? JSON.stringify(b.requestSnapshot) : null,
        b.timestamp || new Date(),
      ],
    );
    const log = rows[0];
    res.status(201).json(fmt(log));

    // Dispatch guest.arrived notification when a guard admits someone (non-blocking).
    // We notify the pass creator (created_by_uid) so they know their guest has arrived.
    if (log.result === 'allowed' && log.created_by_uid) {
      const propertyDb = req.db || null;
      if (propertyDb) {
        notifyDispatch(
          'guest.arrived',
          { userId: log.created_by_uid, visitorName: log.visitor_name || undefined },
          propertyDb,
          req.property || null,
        ).catch(() => {}); // belt-and-suspenders; dispatch already swallows errors
      }
    }
  } catch (err) { next(err); }
});

router.delete('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    // FIX [AUDIT-3 #7]: обязательное подтверждение — защита от случайного вызова.
    // Без этого один неверный запрос от admin удаляет всю историю посещений.
    if (req.body?.confirm !== 'DELETE_ALL_LOGS') {
      return res.status(400).json({
        error: 'Dangerous operation. Send body: { "confirm": "DELETE_ALL_LOGS" }',
      });
    }

    const { rowCount } = await db.query(`DELETE FROM visit_logs`);
    logger.warn({ uid: req.user.uid, rowCount }, '[visit-logs] admin cleared all logs');
    res.json({ ok: true, deleted: rowCount });
  } catch (err) { next(err); }
});

// GET /api/visit-logs/:id — детальная запись с request_snapshot
router.get('/:id', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!isValidVisitLogId(String(req.params.id || ''))) {
      return res.status(400).json({ error: 'Invalid id format' });
    }
    const { rows } = await db.query(
      `SELECT id, user_id, request_id, visitor_name, category, car_plate,
              created_by_apt, created_by_name, created_by_uid,
              actor_name, actor_role, result, reason, request_snapshot, timestamp
       FROM visit_logs WHERE id=$1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(fmt(rows[0]));
  } catch (err) { next(err); }
});

module.exports = router;
