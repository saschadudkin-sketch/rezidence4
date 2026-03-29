'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const db      = require('../db');
const logger  = require('../logger'); // FIX [КРИТ-2]: logger был вызван без импорта
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants'); // FIX [CODE-1]

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

router.get('/', async (req, res, next) => {
  try {
    if (!isStaff(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // FIX [PERF-1]: пагинация — 500 строк с JSONB-снепшотами = ~2.5MB одним ответом
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    // Приблизительный счётчик строк через pg_class.reltuples (обновляется VACUUM/ANALYZE).
    // FIX: убрано дублирование — reltuples читался ДВАЖДЫ в одном запросе через два
    // независимых подзапроса. Теперь — один CTE, одно чтение pg_class.
    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(
        `SELECT id, user_id, request_id, visitor_name, category, car_plate,
                created_by_apt, created_by_name, created_by_uid,
                actor_name, actor_role, result, reason, timestamp
         FROM visit_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      db.query(
        `WITH stats AS (
           SELECT reltuples::bigint AS est
           FROM pg_class WHERE relname = 'visit_logs'
         )
         SELECT CASE
           WHEN (SELECT est FROM stats) < 1
           THEN (SELECT COUNT(*) FROM visit_logs)
           ELSE (SELECT est FROM stats)
         END AS count`
      ),
    ]);
    res.json({
      data:  rows.map(fmt),
      total: Number(countRows[0].count),
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
    res.status(201).json(fmt(rows[0]));
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
