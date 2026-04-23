'use strict';

// platform-v1 packages_v2 service — Spec: packages-v2-spec.md §3 (state machine)
// и §5.1 (outbox triggers).
//
// Журнал посылок, принимаемых на ресепшн от имени резидентов.  Чистая
// бизнес-логика + интеграция с `notifications_outbox`.  HTTP-слой (router) —
// отдельно, здесь только pool + transaction + enqueueNotification.
//
// Ключевые приглашённые инварианты:
//   1. State machine §3: awaiting_pickup → {picked_up, returned, lost}
//      все терминальны.  Попытка перехода из terminal → 409 (caller).
//   2. CHECK packages_v2_pickup_identity_exclusive: НЕ оба
//      (picked_up_by_resident_id, picked_up_by_name) одновременно.
//   3. CHECK packages_v2_pickup_identity_required: status='picked_up' требует
//      хотя бы один из двух.
//   4. POST (receive) → enqueueNotification package.received в ТОЙ ЖЕ транзакции.
//   5. POST /:id/pickup → enqueueNotification package.picked_up_confirmation
//      в той же транзакции, ТОЛЬКО если picked_up_by_resident_id не null.
//   6. POST /:id/remind → enqueueNotification package.pickup_reminder (manual).
//
// Auth-level проверки остаются в router'е — здесь доверяем тому, что actor
// имеет право на действие.  Единственное исключение — mark-lost требует
// `confirm: true` аргумент, чтобы нельзя было случайно потерять строку.

const {
  enqueueNotification,
  enqueueNotificationBatch,
} = require('./notificationOutbox');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SIZES = new Set([
  'envelope', 'small', 'medium', 'large', 'oversize',
]);
const ALLOWED_STATUSES = new Set([
  'awaiting_pickup', 'picked_up', 'returned', 'lost',
]);

// Каналы, на которые fan-out'им уведомления резиденту.  sms+web_push —
// по спецификации §5.1; telegram добавится, когда резидент подключит бот.
const RECEIVE_CHANNELS = ['sms', 'web_push'];
const REMIND_CHANNELS = ['sms', 'web_push'];
const PICKUP_CONFIRM_CHANNELS = ['web_push'];

const FULL_COLS = `
  id, property_id, unit_id,
  recipient_resident_id, recipient_name_snapshot,
  sender_name, carrier, tracking_number,
  photo_url, size_category,
  received_at, received_by_staff_id, storage_location,
  status,
  picked_up_at, picked_up_by_resident_id, picked_up_by_name, picked_up_by_staff_id,
  returned_at, returned_reason,
  notes, created_at, updated_at
`;

function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
function isValidIso(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

function clampLimit(raw, def = 100, max = 500) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// ─── Resolution helpers ──────────────────────────────────────────────────────

/**
 * resolveResidentByUid — legacy users.uid → residents.id.  Used when POST
 * principal is a resident and we need to auth-gate /mine.  Returns null for
 * unknown uid (pre-Phase-7 legacy user).
 */
async function resolveResidentByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id FROM residents WHERE external_uid = $1 LIMIT 1`,
    [uid],
  );
  return rows[0]?.id || null;
}

/**
 * resolveUnitIdsForResident — все unit'ы, в которых резидент active.  Нужен
 * для /mine чтобы показать "посылки адресованные на мою квартиру без явного
 * получателя" (recipient_resident_id IS NULL AND unit_id IN ...).
 */
async function resolveUnitIdsForResident(db, residentId) {
  if (!residentId) return [];
  const { rows } = await db.query(
    `SELECT unit_id FROM resident_unit_links
      WHERE resident_id = $1 AND is_active = TRUE`,
    [residentId],
  );
  return rows.map((r) => r.unit_id);
}

/**
 * resolveStaffIdByUid — legacy users.uid → staff_users.id.  Нужно для
 * received_by_staff_id / picked_up_by_staff_id NOT NULL FK.  Если не
 * найден — throws (в router'е ловим как 400/403 — staff user должен быть
 * зарегистрирован в staff_users таблице).
 */
async function resolveStaffIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id FROM staff_users WHERE external_uid = $1 LIMIT 1`,
    [uid],
  );
  return rows[0]?.id || null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * listForTenant — staff/admin list.  Все фильтры optional.  Default sort —
 * received_at DESC.  Покрывается индексом
 * (property_id, status, received_at DESC) когда status задан.
 */
async function listForTenant(db, filters = {}) {
  const clauses = [];
  const args = [];

  if (filters.status) {
    if (!ALLOWED_STATUSES.has(filters.status)) {
      throw new Error(`invalid status filter: ${filters.status}`);
    }
    args.push(filters.status);
    clauses.push(`status = $${args.length}`);
  }
  if (filters.unit_id) {
    if (!isValidUuid(filters.unit_id)) throw new Error('unit_id must be UUID');
    args.push(filters.unit_id);
    clauses.push(`unit_id = $${args.length}`);
  }
  if (filters.recipient_resident_id) {
    if (!isValidUuid(filters.recipient_resident_id)) {
      throw new Error('recipient_resident_id must be UUID');
    }
    args.push(filters.recipient_resident_id);
    clauses.push(`recipient_resident_id = $${args.length}`);
  }
  if (filters.carrier) {
    args.push(String(filters.carrier));
    clauses.push(`carrier = $${args.length}`);
  }
  if (filters.since) {
    if (!isValidIso(filters.since)) throw new Error('since must be ISO-8601');
    args.push(filters.since);
    clauses.push(`received_at >= $${args.length}`);
  }
  if (filters.until) {
    if (!isValidIso(filters.until)) throw new Error('until must be ISO-8601');
    args.push(filters.until);
    clauses.push(`received_at <= $${args.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
  args.push(limit, offset);

  const sql =
    `SELECT ${FULL_COLS}
       FROM packages_v2
       ${where}
      ORDER BY received_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`;

  const { rows } = await db.query(sql, args);
  return { rows, limit, offset };
}

/**
 * listForResident — /mine.  Возвращает:
 *  (a) все посылки где recipient_resident_id = residentId (все статусы)
 *  (b) посылки где recipient_resident_id IS NULL и unit_id ∈ residentUnits
 *      (статус не 'lost' — /mine скрывает lost, это внутренний статус УК)
 * Ограничение: свежие 90 дней.  Индексы
 * (property_id, recipient_resident_id, status) partial и (property_id, unit_id, status)
 * покрывают оба сценария.
 */
async function listForResident(db, residentId, unitIds = [], opts = {}) {
  if (!residentId) return [];
  const limit = clampLimit(opts.limit, 50, 200);
  const args = [residentId];
  let unitFilter = '';
  if (unitIds.length > 0) {
    // Безопасность: все входящие uuid'ы уже проверены вызывающей стороной.
    args.push(unitIds);
    unitFilter = `OR (recipient_resident_id IS NULL AND unit_id = ANY($${args.length}::uuid[]))`;
  }
  args.push(limit);
  const { rows } = await db.query(
    `SELECT ${FULL_COLS}
       FROM packages_v2
      WHERE (recipient_resident_id = $1 ${unitFilter})
        AND status <> 'lost'
        AND received_at >= NOW() - INTERVAL '90 days'
      ORDER BY received_at DESC
      LIMIT $${args.length}`,
    args,
  );
  return rows;
}

async function getById(db, id) {
  if (!isValidUuid(id)) return null;
  const { rows } = await db.query(
    `SELECT ${FULL_COLS} FROM packages_v2 WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

// ─── Mutations (transactional, outbox-coupled) ───────────────────────────────

/**
 * createPackage — POST /packages.  Вставка строки + fan-out уведомлений
 * резиденту в одной транзакции.  Если recipient_resident_id null —
 * уведомляем всех active резидентов unit'а (см. spec §5.1 "recipient_resident_id
 * OR all active residents of unit").
 *
 * @param {Pool} pool
 * @param {Object} input  { propertyId, unitId, recipientResidentId?, recipientNameSnapshot?,
 *                          senderName?, carrier?, trackingNumber?, photoUrl?, sizeCategory?,
 *                          receivedByStaffId, storageLocation?, notes? }
 * @returns {Promise<{package, outboxRows}>}
 */
async function createPackage(pool, input) {
  const {
    propertyId, unitId,
    recipientResidentId = null,
    recipientNameSnapshot = null,
    senderName = null,
    carrier = null,
    trackingNumber = null,
    photoUrl = null,
    sizeCategory = null,
    receivedByStaffId,
    storageLocation = null,
    notes = null,
  } = input;

  if (!isValidUuid(propertyId)) throw new Error('propertyId must be UUID');
  if (!isValidUuid(unitId)) throw new Error('unitId must be UUID');
  if (!isValidUuid(receivedByStaffId)) throw new Error('receivedByStaffId must be UUID');
  if (recipientResidentId !== null && !isValidUuid(recipientResidentId)) {
    throw new Error('recipientResidentId must be UUID or null');
  }
  if (sizeCategory !== null && !ALLOWED_SIZES.has(sizeCategory)) {
    throw new Error(`invalid sizeCategory: ${sizeCategory}`);
  }
  if (photoUrl !== null && typeof photoUrl === 'string' && !photoUrl.startsWith('/uploads/')) {
    throw new Error('photoUrl must start with /uploads/ (CLAUDE.md §Uploads)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO packages_v2
         (property_id, unit_id, recipient_resident_id, recipient_name_snapshot,
          sender_name, carrier, tracking_number, photo_url, size_category,
          received_by_staff_id, storage_location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${FULL_COLS}`,
      [
        propertyId, unitId, recipientResidentId, recipientNameSnapshot,
        senderName, carrier, trackingNumber, photoUrl, sizeCategory,
        receivedByStaffId, storageLocation, notes,
      ],
    );
    const pkg = rows[0];

    // Резолвим получателей для outbox.  Если recipientResidentId задан —
    // отправляем только ему.  Иначе — всем active резидентам unit'а.
    const recipientIds = recipientResidentId
      ? [recipientResidentId]
      : await fetchActiveResidentIdsForUnit(client, unitId);

    const payload = {
      title: 'Вам посылка',
      body: buildPackageReceivedBody(pkg),
      url: `/packages/${pkg.id}`,
      // Специфичные для package поля (outbox worker пропустит как есть в
      // notification_log_v2.payload; /mine их увидит после trimPayloadForResident).
      package_id: pkg.id,
      sender_name: pkg.sender_name,
      carrier: pkg.carrier,
      tracking_number: pkg.tracking_number,
      storage_location: pkg.storage_location,
    };

    const outboxParams = [];
    for (const rid of recipientIds) {
      for (const channel of RECEIVE_CHANNELS) {
        outboxParams.push({
          propertyId,
          eventType: 'package.received',
          channel,
          recipientType: 'resident',
          recipientId: rid,
          payload,
          correlationId: pkg.id,
        });
      }
    }

    const outboxRows = outboxParams.length > 0
      ? await enqueueNotificationBatch(client, outboxParams)
      : [];

    await client.query('COMMIT');
    return { package: pkg, outboxRows };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * updatePackage — PATCH /packages/:id.  Только metadata (carrier, notes,
 * storage_location, photo_url, size_category).  НЕ меняет status — status
 * меняется только через pickup/return/mark-lost endpoints, которые enforce'ят
 * state machine invariants.
 */
async function updatePackage(db, id, patch) {
  if (!isValidUuid(id)) throw new Error('id must be UUID');
  const fields = [];
  const args = [];
  const allowed = {
    carrier:          'carrier',
    notes:            'notes',
    storage_location: 'storage_location',
    photo_url:        'photo_url',
    size_category:    'size_category',
  };
  for (const [key, col] of Object.entries(allowed)) {
    if (patch[key] === undefined) continue;
    if (key === 'size_category' && patch[key] !== null && !ALLOWED_SIZES.has(patch[key])) {
      throw new Error(`invalid size_category: ${patch[key]}`);
    }
    if (key === 'photo_url' && patch[key] !== null && typeof patch[key] === 'string'
        && !patch[key].startsWith('/uploads/')) {
      throw new Error('photo_url must start with /uploads/');
    }
    args.push(patch[key]);
    fields.push(`${col} = $${args.length}`);
  }
  if (fields.length === 0) {
    // Идемпотентный no-op: возвращаем текущую строку.
    return getById(db, id);
  }
  args.push(id);
  const { rows } = await db.query(
    `UPDATE packages_v2
        SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${args.length}
      RETURNING ${FULL_COLS}`,
    args,
  );
  return rows[0] || null;
}

/**
 * pickupPackage — POST /packages/:id/pickup.  State transition
 * awaiting_pickup → picked_up + outbox(package.picked_up_confirmation).
 *
 * Body validation (эхирует CHECK constraints §2):
 *   - Либо pickedUpByResidentId (резидент забрал сам), либо pickedUpByName
 *     (член семьи/курьер); не оба, не пусто.
 *   - pickedUpByStaffId NOT NULL.
 *
 * 409 — посылка уже в terminal состоянии (caller пишет текст ошибки).
 */
async function pickupPackage(pool, id, input) {
  const {
    pickedUpByResidentId = null,
    pickedUpByName = null,
    pickedUpByStaffId,
  } = input;

  if (!isValidUuid(id)) throw new Error('id must be UUID');
  if (!isValidUuid(pickedUpByStaffId)) throw new Error('pickedUpByStaffId must be UUID');
  if (pickedUpByResidentId !== null && !isValidUuid(pickedUpByResidentId)) {
    throw new Error('pickedUpByResidentId must be UUID or null');
  }
  if (!pickedUpByResidentId && !pickedUpByName) {
    throw new Error('either pickedUpByResidentId or pickedUpByName required');
  }
  if (pickedUpByResidentId && pickedUpByName) {
    throw new Error('pickedUpByResidentId and pickedUpByName are mutually exclusive');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE — lock'им строку, чтобы параллельный pickup не прошёл.
    const { rows: curRows } = await client.query(
      `SELECT id, property_id, status FROM packages_v2 WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!curRows[0]) {
      await client.query('ROLLBACK');
      return { package: null, outboxRows: [], conflict: 'not_found' };
    }
    if (curRows[0].status !== 'awaiting_pickup') {
      await client.query('ROLLBACK');
      return { package: null, outboxRows: [], conflict: curRows[0].status };
    }
    const propertyId = curRows[0].property_id;

    const { rows } = await client.query(
      `UPDATE packages_v2
          SET status = 'picked_up',
              picked_up_at = NOW(),
              picked_up_by_resident_id = $1,
              picked_up_by_name = $2,
              picked_up_by_staff_id = $3,
              updated_at = NOW()
        WHERE id = $4
        RETURNING ${FULL_COLS}`,
      [pickedUpByResidentId, pickedUpByName, pickedUpByStaffId, id],
    );
    const pkg = rows[0];

    // Подтверждение отправляем только если забирает сам резидент (есть кому).
    // Для pickedUpByName (не-резидент) — подтверждения нет.
    let outboxRows = [];
    if (pickedUpByResidentId) {
      outboxRows = [await enqueueNotification(client, {
        propertyId,
        eventType: 'package.picked_up_confirmation',
        channel: PICKUP_CONFIRM_CHANNELS[0],
        recipientType: 'resident',
        recipientId: pickedUpByResidentId,
        payload: {
          title: 'Посылка получена',
          body: 'Вы получили посылку — подтверждено на ресепшн.',
          url: `/packages/${pkg.id}`,
          package_id: pkg.id,
          picked_up_at: pkg.picked_up_at,
        },
        correlationId: pkg.id,
      })];
    }

    await client.query('COMMIT');
    return { package: pkg, outboxRows, conflict: null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * returnPackage — POST /packages/:id/return.  Transition
 * awaiting_pickup → returned.  reason — optional (см. §2 note).
 * Уведомлений не шлём — резидент уже игнорировал посылку, лишний push лишний.
 */
async function returnPackage(db, id, input) {
  if (!isValidUuid(id)) throw new Error('id must be UUID');
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : null;

  const { rows: curRows } = await db.query(
    `SELECT status FROM packages_v2 WHERE id = $1`,
    [id],
  );
  if (!curRows[0]) return { package: null, conflict: 'not_found' };
  if (curRows[0].status !== 'awaiting_pickup') {
    return { package: null, conflict: curRows[0].status };
  }

  const { rows } = await db.query(
    `UPDATE packages_v2
        SET status = 'returned',
            returned_at = NOW(),
            returned_reason = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING ${FULL_COLS}`,
    [reason, id],
  );
  return { package: rows[0], conflict: null };
}

/**
 * markLostPackage — POST /packages/:id/mark-lost.  Требует `confirm: true` —
 * это защита от случайного клика в UI.  Запись в любой terminal статус —
 * безвозвратна в рамках этой посылки (создать новую — можно).
 */
async function markLostPackage(db, id, input) {
  if (!isValidUuid(id)) throw new Error('id must be UUID');
  if (input?.confirm !== true) throw new Error('confirm:true required');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : null;
  if (!reason) throw new Error('reason required');

  const { rows: curRows } = await db.query(
    `SELECT status FROM packages_v2 WHERE id = $1`,
    [id],
  );
  if (!curRows[0]) return { package: null, conflict: 'not_found' };
  if (curRows[0].status !== 'awaiting_pickup') {
    return { package: null, conflict: curRows[0].status };
  }

  const { rows } = await db.query(
    `UPDATE packages_v2
        SET status = 'lost',
            returned_reason = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING ${FULL_COLS}`,
    [reason, id],
  );
  return { package: rows[0], conflict: null };
}

/**
 * remindPackage — POST /packages/:id/remind.  Ручное напоминание резиденту
 * (дополнительно к SLA-scheduler'у).  Работает только для awaiting_pickup.
 * Fan-out'им на те же каналы, что и receive, но payload помечен `manual:true`.
 */
async function remindPackage(pool, id) {
  if (!isValidUuid(id)) throw new Error('id must be UUID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT ${FULL_COLS} FROM packages_v2 WHERE id = $1`,
      [id],
    );
    if (!curRows[0]) {
      await client.query('ROLLBACK');
      return { package: null, outboxRows: [], conflict: 'not_found' };
    }
    const pkg = curRows[0];
    if (pkg.status !== 'awaiting_pickup') {
      await client.query('ROLLBACK');
      return { package: pkg, outboxRows: [], conflict: pkg.status };
    }

    const recipientIds = pkg.recipient_resident_id
      ? [pkg.recipient_resident_id]
      : await fetchActiveResidentIdsForUnit(client, pkg.unit_id);

    const daysWaiting = Math.max(
      0,
      Math.floor((Date.now() - new Date(pkg.received_at).getTime()) / (24 * 3600 * 1000)),
    );
    const payload = {
      title: 'Напоминание: посылка ждёт вас',
      body: `Ваша посылка на ресепшн уже ${daysWaiting} дней. Пожалуйста, заберите.`,
      url: `/packages/${pkg.id}`,
      package_id: pkg.id,
      days_waiting: daysWaiting,
      received_at: pkg.received_at,
      manual: true,
    };
    const outboxParams = [];
    for (const rid of recipientIds) {
      for (const channel of REMIND_CHANNELS) {
        outboxParams.push({
          propertyId: pkg.property_id,
          eventType: 'package.pickup_reminder',
          channel,
          recipientType: 'resident',
          recipientId: rid,
          payload,
          correlationId: pkg.id,
        });
      }
    }
    const outboxRows = outboxParams.length > 0
      ? await enqueueNotificationBatch(client, outboxParams)
      : [];

    await client.query('COMMIT');
    return { package: pkg, outboxRows, conflict: null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

async function getMetrics(db, hoursBack = 24 * 7) {
  const hours = Number(hoursBack);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new TypeError('hoursBack must be positive number');
  }
  const intervalArg = `${Math.floor(hours)} hours`;

  // Open count (текущее состояние, независимо от hoursBack).
  const { rows: openRows } = await db.query(
    `SELECT COUNT(*)::int AS open_count FROM packages_v2 WHERE status = 'awaiting_pickup'`,
  );

  // Средний pickup-time (часы) за окно: диф picked_up_at − received_at.
  const { rows: avgRows } = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (picked_up_at - received_at)) / 3600.0) AS avg_hours
       FROM packages_v2
      WHERE status = 'picked_up'
        AND picked_up_at IS NOT NULL
        AND picked_up_at >= NOW() - $1::interval`,
    [intervalArg],
  );

  // Процент returned за окно.
  const { rows: retRows } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'returned')::int AS returned,
        COUNT(*) FILTER (WHERE status IN ('returned','picked_up','lost'))::int AS closed
       FROM packages_v2
      WHERE created_at >= NOW() - $1::interval`,
    [intervalArg],
  );

  // Top carriers (по volume за окно).
  const { rows: carRows } = await db.query(
    `SELECT carrier, COUNT(*)::int AS total
       FROM packages_v2
      WHERE created_at >= NOW() - $1::interval
        AND carrier IS NOT NULL
      GROUP BY carrier
      ORDER BY total DESC
      LIMIT 10`,
    [intervalArg],
  );

  const closed = retRows[0]?.closed || 0;
  const returned = retRows[0]?.returned || 0;
  return {
    period_hours: Math.floor(hours),
    generated_at: new Date().toISOString(),
    open_count: openRows[0]?.open_count || 0,
    avg_pickup_hours: avgRows[0]?.avg_hours === null || avgRows[0]?.avg_hours === undefined
      ? null
      : Number(avgRows[0].avg_hours),
    returned_rate: closed === 0 ? null : returned / closed,
    top_carriers: carRows.map((r) => ({ carrier: r.carrier, total: Number(r.total) })),
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function fetchActiveResidentIdsForUnit(client, unitId) {
  const { rows } = await client.query(
    `SELECT resident_id
       FROM resident_unit_links
      WHERE unit_id = $1 AND is_active = TRUE`,
    [unitId],
  );
  return rows.map((r) => r.resident_id);
}

function buildPackageReceivedBody(pkg) {
  const bits = [];
  if (pkg.sender_name) bits.push(`от ${pkg.sender_name}`);
  if (pkg.carrier) bits.push(`(${pkg.carrier})`);
  const from = bits.join(' ');
  if (pkg.storage_location) {
    return `Посылка${from ? ' ' + from : ''} — хранение: ${pkg.storage_location}`;
  }
  return `Посылка${from ? ' ' + from : ''} ожидает на ресепшн.`;
}

module.exports = {
  listForTenant,
  listForResident,
  getById,
  createPackage,
  updatePackage,
  pickupPackage,
  returnPackage,
  markLostPackage,
  remindPackage,
  getMetrics,
  resolveResidentByUid,
  resolveStaffIdByUid,
  resolveUnitIdsForResident,
  // exports for tests + admin introspection:
  ALLOWED_STATUSES,
  ALLOWED_SIZES,
  RECEIVE_CHANNELS,
  REMIND_CHANNELS,
  PICKUP_CONFIRM_CHANNELS,
  clampLimit,
  buildPackageReceivedBody,
};
