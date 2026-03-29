/**
 * services/RequestsService.js — FIX [A3]: Service Layer
 *
 * ПРОБЛЕМА: routes/requests.js содержал ~300 строк с проверкой прав,
 * валидацией переходов, обновлением БД, записью истории и SSE broadcast
 * в одном месте. Нарушает SRP, сложно тестировать.
 *
 * РЕШЕНИЕ: Весь domain logic — здесь. Routes — только HTTP.
 */

'use strict';
const { v4: uuid } = require('uuid');
const db            = require('../db');
const { isStaff }   = require('../constants');

// ─── Row → frontend object ────────────────────────────────────────────────────

function fmt(r) {
  return {
    id:             r.id,
    type:           r.type,
    category:       r.category,
    status:         r.status,
    priority:       'normal',
    createdByUid:   r.created_by_uid,
    createdByName:  r.created_by_name,
    createdByRole:  r.created_by_role,
    createdByApt:   r.created_by_apt,
    visitorName:    r.visitor_name,
    visitorPhone:   r.visitor_phone,
    carPlate:       r.car_plate,
    comment:        r.comment,
    passDuration:   r.pass_duration,
    validUntil:     r.valid_until,
    scheduledFor:   r.scheduled_for,
    arrivedAt:      r.arrived_at,
    photos:         r.photos || [],
    photo:          (r.photos && r.photos[0]) || null,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

// ─── Status transition matrix ─────────────────────────────────────────────────

const STATUS_TRANSITIONS = {
  owner:      { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  tenant:     { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  contractor: { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  // Консьерж: только просмотр + отмена своих заявок (без одобрения/отклонения)
  concierge:  { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  security:   {
    from: new Set(['pending', 'approved', 'accepted']),
    to:   new Set(['approved', 'rejected', 'arrived', 'accepted']),
  },
  admin: null,
};

function canTransition(role, currentStatus, nextStatus) {
  const rules = STATUS_TRANSITIONS[role];
  if (!rules) return true;
  return rules.from.has(currentStatus) && rules.to.has(nextStatus);
}

// ─── Validation constants ─────────────────────────────────────────────────────

const VALID_TYPES = new Set(['pass', 'tech']);
const VALID_CATS  = new Set([
  'guest', 'courier', 'taxi', 'car', 'master', 'cleaner', 'other',
  'worker', 'team', 'delivery', 'electrician', 'plumber',
]);
const ALLOWED_INITIAL_STATUSES = new Set(['pending', 'scheduled']);

// FIX [DRY]: единая карта ограничений длины — была продублирована в create() и update().
// historyLabel добавлен: без проверки авторизованный пользователь записывал 1MB в историю,
// что рассылалось через SSE broadcast всем клиентам.
const FIELD_MAX = Object.freeze({
  visitorName:  200,
  visitorPhone:  30,
  carPlate:      20,
  comment:     2000,
  historyLabel:  200,
});

function validateFieldLengths(data) {
  for (const [field, max] of Object.entries(FIELD_MAX)) {
    if (data[field] != null && typeof data[field] === 'string' && data[field].length > max) {
      throw new ServiceError(`${field} too long (max ${max} chars)`);
    }
  }
}

const COLS = `id, type, category, status,
  created_by_uid, created_by_name, created_by_role, created_by_apt,
  visitor_name, visitor_phone, car_plate, comment, pass_duration,
  valid_until, scheduled_for, arrived_at, photos,
  created_at, updated_at`;

// ─── Transaction helper ───────────────────────────────────────────────────────

async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Custom error for HTTP status mapping ─────────────────────────────────────

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ─── Service methods ──────────────────────────────────────────────────────────

class RequestsService {
  /**
   * Получить список заявок с пагинацией.
   * @returns {{ data: object[], total: number, page: number, limit: number }}
   */
  static async list({ uid, role }, { page = 1, limit = 50 } = {}) {
    page  = Math.max(1, page);
    limit = Math.min(100, limit);
    const offset = (page - 1) * limit;
    const staff  = isStaff(role);

    // FIX [PERF]: было два отдельных запроса (SELECT rows + SELECT COUNT) — два roundtrip к БД.
    // Теперь один запрос с window function COUNT(*) OVER() — один roundtrip.
    // При высоком RPS (200 RPM) это убирает 200 лишних DB-запросов в минуту только для list().
    let rows;
    if (staff) {
      ({ rows } = await db.query(
        `SELECT ${COLS}, COUNT(*) OVER() AS total_count
         FROM requests WHERE deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT ${COLS}, COUNT(*) OVER() AS total_count
         FROM requests WHERE created_by_uid=$1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [uid, limit, offset],
      ));
    }

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { data: rows.map(fmt), total, page, limit };
  }

  /**
   * Создать заявку.
   * @returns {object} Созданная заявка (formatted)
   */
  static async create(user, body) {
    const { uid, name, role } = user;

    if (!VALID_TYPES.has(body.type)) {
      throw new ServiceError(`Invalid type. Allowed: ${[...VALID_TYPES].join(', ')}`);
    }
    if (!VALID_CATS.has(body.category)) {
      throw new ServiceError(`Invalid category. Allowed: ${[...VALID_CATS].join(', ')}`);
    }

    validateFieldLengths(body);

    const id = uuid();
    const initialStatus = body.status || 'pending';

    if (!isStaff(role) && !ALLOWED_INITIAL_STATUSES.has(initialStatus)) {
      throw new ServiceError('Residents can only create pending or scheduled requests', 403);
    }

    const { rows } = await db.query(
      `INSERT INTO requests
         (id, type, category, status, created_by_uid, created_by_name, created_by_role,
          created_by_apt, visitor_name, visitor_phone, car_plate, comment,
          pass_duration, valid_until, scheduled_for, photos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id, body.type, body.category, initialStatus,
        uid, name, role,
        body.createdByApt || null,
        body.visitorName  || null,
        body.visitorPhone || null,
        body.carPlate     || null,
        body.comment      || '',
        body.passDuration || 'once',
        body.validUntil   || null,
        body.scheduledFor || null,
        body.photos       || [],
      ],
    );

    return fmt(rows[0]);
  }

  /**
   * Обновить заявку (статус, комментарий и т.д.)
   * @returns {object} Обновлённая заявка
   */
  static async update(user, id, patch) {
    const { uid, name, role } = user;
    const staff = isStaff(role);

    const { rows: existing } = await db.query(
      `SELECT id, status, created_by_uid FROM requests WHERE id=$1 AND deleted_at IS NULL`, [id],
    );
    if (!existing.length) throw new ServiceError('Not found', 404);

    const currentReq = existing[0];

    if (!staff && currentReq.created_by_uid !== uid) {
      throw new ServiceError('Forbidden', 403);
    }

    if (patch.status !== undefined) {
      if (!canTransition(role, currentReq.status, patch.status)) {
        throw new ServiceError(
          `Role '${role}' cannot transition status from '${currentReq.status}' to '${patch.status}'`, 403
        );
      }
    }

    // Валидация длины — включает historyLabel (max 200 chars)
    validateFieldLengths(patch);

    const fields = [];
    const vals   = [];
    let   i      = 1;

    const map = {
      status: 'status', comment: 'comment', visitorName: 'visitor_name',
      visitorPhone: 'visitor_phone', carPlate: 'car_plate', arrivedAt: 'arrived_at',
      scheduledFor: 'scheduled_for', validUntil: 'valid_until',
      passDuration: 'pass_duration', photos: 'photos',
    };

    for (const [key, col] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        fields.push(`${col}=$${i++}`);
        vals.push(patch[key]);
      }
    }

    fields.push(`updated_at=$${i++}`);
    vals.push(new Date());
    vals.push(id);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE requests SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals,
      );
      if (!rows.length) return null;

      if (patch.historyLabel) {
        await client.query(
          `INSERT INTO request_history(req_id, by_name, by_role, label) VALUES($1,$2,$3,$4)`,
          [id, name, role, patch.historyLabel],
        );
      }
      return fmt(rows[0]);
    });

    if (!updated) throw new ServiceError('Not found', 404);
    return updated;
  }

  /**
   * Soft-delete заявки.
   */
  static async delete(user, id) {
    const { uid, role } = user;

    if (role !== 'admin') {
      const { rows } = await db.query(
        `SELECT id FROM requests WHERE id=$1 AND created_by_uid=$2 AND status='pending' AND deleted_at IS NULL`,
        [id, uid],
      );
      if (!rows.length) throw new ServiceError('Forbidden', 403);
    }

    await db.query(`UPDATE requests SET deleted_at = NOW(), updated_at = NOW() WHERE id=$1`, [id]);
    return { ok: true };
  }

  /**
   * Получить историю заявки.
   */
  static async getHistory(id) {
    const { rows } = await db.query(
      `SELECT by_name, by_role, label, at FROM request_history WHERE req_id=$1 ORDER BY at`, [id],
    );
    return rows.map(h => ({ byName: h.by_name, byRole: h.by_role, action: h.label, at: h.at }));
  }
}

module.exports = { RequestsService, ServiceError };
