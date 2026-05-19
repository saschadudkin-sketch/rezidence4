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
const { randomUUID: uuid } = require('crypto');
const db            = require('../db');
const { isStaff }   = require('../constants');
const { REQUEST_COLUMNS, formatRequestRow, formatRequestHistoryRow } = require('./requests/RequestFormatter');
const {
  STATUS_TRANSITIONS,
  serializeStatusTransitions,
  canTransition,
} = require('./requests/RequestStatusTransitions');
const {
  isAutoApprovedPass,
  validateCreatePayload,
  validateInitialStatus,
  validateUpdatePayload,
} = require('./requests/RequestValidator');
const {
  listRequestCategories,
  resolveRequestCategory,
  upsertRequestCategory,
  computeDueDate,
  normalizeRequestTarget,
} = require('./requests/RequestCategories');
const {
  createEmergencyProfileForRequest,
} = require('./requests/EmergencyDispatchService');
const { ServiceError, ConflictError } = require('./requests/RequestErrors');
const { dispatchEvent } = require('../v1/services/notificationDispatcher');

// ─── Transaction helper ───────────────────────────────────────────────────────

async function withTransaction(txPool, fn) {
  const client = await txPool.connect();
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

// ─── Service methods ──────────────────────────────────────────────────────────

class RequestsService {
  static async listCategories(queryDb = db, { propertyId } = {}) {
    return listRequestCategories(queryDb, { propertyId });
  }

  static async upsertCategory(user, queryDb = db, propertyId, code, body) {
    if (user.role !== 'admin') throw new ServiceError('Forbidden', 403);
    return upsertRequestCategory(queryDb, propertyId, code, body);
  }

  /**
   * Получить одну заявку по id с проверкой доступа.
   * Жилец видит только свои заявки; персонал и админ видят все.
   * @returns {object} Заявка (formatted)
   */
  static async getOne(user, id, queryDb = db) {
    const { uid, role } = user;
    const staff = isStaff(role);

    let rows;
    if (staff || role === 'admin') {
      ({ rows } = await queryDb.query(
        `SELECT ${REQUEST_COLUMNS} FROM requests WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      ));
    } else {
      ({ rows } = await queryDb.query(
        `SELECT ${REQUEST_COLUMNS} FROM requests WHERE id=$1 AND created_by_uid=$2 AND deleted_at IS NULL`,
        [id, uid],
      ));
    }

    if (!rows.length) throw new ServiceError('Not found', 404);
    return formatRequestRow(rows[0]);
  }

  /**
   * Получить список заявок с пагинацией.
   * @returns {{ data: object[], total: number, page: number, limit: number }}
   */
  static async list({ uid, role }, { page = 1, limit = 50 } = {}, queryDb = db) {
    page  = Math.max(1, page);
    limit = Math.min(100, limit);
    const offset = (page - 1) * limit;
    const staff  = isStaff(role);

    // FIX [PERF]: было два отдельных запроса (SELECT rows + SELECT COUNT) — два roundtrip к БД.
    // Теперь один запрос с window function COUNT(*) OVER() — один roundtrip.
    // При высоком RPS (200 RPM) это убирает 200 лишних DB-запросов в минуту только для list().
    let rows;
    if (staff) {
      ({ rows } = await queryDb.query(
        `SELECT ${REQUEST_COLUMNS}, COUNT(*) OVER() AS total_count
         FROM requests WHERE deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ));
    } else {
      ({ rows } = await queryDb.query(
        `SELECT ${REQUEST_COLUMNS}, COUNT(*) OVER() AS total_count
         FROM requests WHERE created_by_uid=$1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [uid, limit, offset],
      ));
    }

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { data: rows.map(formatRequestRow), total, page, limit };
  }

  /**
   * Создать заявку.
   * @returns {object} Созданная заявка (formatted)
   */
  static async create(user, body, queryDb = db, { propertyId } = {}) {
    const { uid, name, role } = user;

    validateCreatePayload(body);
    const categoryProfile = await resolveRequestCategory(queryDb, body.category, { propertyId });
    const { targetType, targetId } = normalizeRequestTarget(body, categoryProfile);

    const id = uuid();
    const requestedStatus = body.status || 'pending';
    const passDuration = body.passDuration || 'once';
    const autoApprovePass = isAutoApprovedPass({
      type: body.type,
      scheduledFor: body.scheduledFor,
      requestedStatus,
    });
    const initialStatus = autoApprovePass ? 'approved' : requestedStatus;
    const firstResponseDueAt = computeDueDate(categoryProfile.firstResponseMinutes);
    const resolutionDueAt = computeDueDate(categoryProfile.resolutionMinutes);
    const emergencyMetadata = categoryProfile.isEmergency
      ? {
          category: categoryProfile.code,
          first_response_minutes: categoryProfile.firstResponseMinutes,
          resolution_minutes: categoryProfile.resolutionMinutes,
        }
      : {};

    validateInitialStatus(role, initialStatus, autoApprovePass, isStaff);

    const { rows } = await queryDb.query(
      `INSERT INTO requests
         (id, type, category, status, created_by_uid, created_by_name, created_by_role,
          created_by_apt, visitor_name, visitor_phone, car_plate, comment,
          pass_duration, valid_until, scheduled_for, photos,
          request_category_id, target_type, target_id, priority, sla_profile,
          first_response_due_at, resolution_due_at, emergency_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        id, body.type, body.category, initialStatus,
        uid, name, role,
        body.createdByApt || null,
        body.visitorName  || null,
        body.visitorPhone || null,
        body.carPlate     || null,
        body.comment      || '',
        passDuration,
        body.validUntil   || null,
        body.scheduledFor || null,
        body.photos       || [],
        categoryProfile.id,
        targetType,
        targetId,
        categoryProfile.priority,
        categoryProfile.slaProfile,
        firstResponseDueAt,
        resolutionDueAt,
        emergencyMetadata,
      ],
    );

    const createdRow = rows[0];
    const emergencyProfile = await createEmergencyProfileForRequest(queryDb, {
      request: createdRow,
      categoryProfile,
      body,
      user,
      propertyId,
    });

    return {
      ...formatRequestRow(createdRow),
      emergencyProfile,
    };
  }

  /**
   * Обновить заявку (статус, комментарий и т.д.)
   * @returns {object} Обновлённая заявка
   */
  static async update(user, id, patch, queryDb = db, txPool = db.pool, context = {}) {
    const { uid, name, role } = user;
    const staff = isStaff(role);

    validateUpdatePayload(patch);

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

    if (patch.status !== undefined && staff && ['approved', 'accepted', 'completed'].includes(patch.status)) {
      fields.push(`first_response_at=COALESCE(first_response_at, NOW())`);
    }
    if (patch.status === 'completed') {
      fields.push(`resolved_at=COALESCE(resolved_at, NOW())`);
      fields.push(`completed_at=COALESCE(completed_at, NOW())`);
      fields.push(`sla_state='resolved'`);
    }

    fields.push(`updated_at=$${i++}`);
    vals.push(new Date());

    const updated = await withTransaction(txPool, async (client) => {
      const { rows: existing } = await client.query(
        `SELECT id, status, created_by_uid
           FROM requests
          WHERE id=$1 AND deleted_at IS NULL
          FOR UPDATE`,
        [id],
      );
      if (!existing.length) return null;

      const currentReq = existing[0];

      if (!staff && currentReq.created_by_uid !== uid) {
        throw new ServiceError('Forbidden', 403);
      }

      if (patch.status !== undefined && patch.expectedCurrentStatus !== undefined && currentReq.status !== patch.expectedCurrentStatus) {
        throw new ConflictError('Request status changed since last read', {
          currentStatus: currentReq.status,
          expectedCurrentStatus: patch.expectedCurrentStatus,
        });
      }

      if (patch.status !== undefined && !canTransition(role, currentReq.status, patch.status)) {
        throw new ServiceError(
          `Role '${role}' cannot transition status from '${currentReq.status}' to '${patch.status}'`, 403
        );
      }

      const { rows } = await client.query(
        `UPDATE requests SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
        [...vals, id],
      );
      if (!rows.length) return null;

      if (patch.historyLabel) {
        await client.query(
          `INSERT INTO request_history(req_id, by_name, by_role, label) VALUES($1,$2,$3,$4)`,
          [id, name, role, patch.historyLabel],
        );
      }
      const formatted = formatRequestRow(rows[0]);
      if (patch.status === 'completed') {
        await dispatchEvent({
          event: 'request.completed',
          data: {
            userId: formatted.createdByUid,
            requestId: formatted.id,
            requestSummary: formatted.visitorName
              ? `Заявка для ${formatted.visitorName}`
              : `Заявка #${formatted.id.slice(0, 8)}`,
            correlationId: formatted.id,
          },
          db: queryDb,
          tx: client,
          property: context.property || null,
        });
      }
      return formatted;
    });

    if (!updated) throw new ServiceError('Not found', 404);
    return updated;
  }

  /**
   * Soft-delete заявки.
   */
  static async delete(user, id, queryDb = db) {
    const { uid, role } = user;

    if (role !== 'admin') {
      const { rows } = await queryDb.query(
        `SELECT id FROM requests WHERE id=$1 AND created_by_uid=$2 AND status='pending' AND deleted_at IS NULL`,
        [id, uid],
      );
      if (!rows.length) throw new ServiceError('Forbidden', 403);
    }

    await queryDb.query(`UPDATE requests SET deleted_at = NOW(), updated_at = NOW() WHERE id=$1`, [id]);
    return { ok: true };
  }

  /**
   * Получить историю заявки.
   * FIX [SECURITY]: добавлена проверка владения/доступа — жилец видит только свои заявки.
   * Ранее любой авторизованный пользователь мог получить историю ЛЮБОЙ заявки по id.
   */
  static async getHistory(user, id, queryDb = db) {
    const { uid, role } = user;
    const staff = isStaff(role);

    if (!staff) {
      const { rows: ownership } = await queryDb.query(
        `SELECT id FROM requests WHERE id=$1 AND created_by_uid=$2 AND deleted_at IS NULL`,
        [id, uid],
      );
      if (!ownership.length) throw new ServiceError('Forbidden', 403);
    }

    const { rows } = await queryDb.query(
      `SELECT by_name, by_role, label, at FROM request_history WHERE req_id=$1 ORDER BY at`, [id],
    );
    return rows.map(formatRequestHistoryRow);
  }
}

module.exports = {
  RequestsService,
  ServiceError,
  ConflictError,
  STATUS_TRANSITIONS,
  serializeStatusTransitions,
};
