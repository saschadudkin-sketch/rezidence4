'use strict';

// platform-v1 announcements_v2 service — Spec: announcements-v2-spec.md §3-§5.
//
// Объявления УК резидентам объекта с аудиенс-таргетингом и fan-out'ом
// уведомлений в момент публикации.  В отличие от documents_v2 — событийная
// сущность: publish триггерит отправку push/sms/telegram/email.
//
// State machine (§3):
//   draft (published_at IS NULL)
//     → scheduled (publish + starts_at > now())   — fan-out пока не идёт
//     → active    (publish + starts_at ≤ now())   — fan-out сразу
//   scheduled → active    через runScheduledFanout() (cron); идемпотентность
//                          обеспечена проверкой correlation_id в outbox
//   active → expired      (natural, expires_at < now(); UI-только)
//   любое → deleted       soft delete (deleted_at)
//
// Ключевые инварианты (дублируем CHECK из 020_announcements_v2.js):
//   1. audience_type = 'all' → все audience_* NULL
//      audience_type = 'building' → только audience_building_id NOT NULL
//      audience_type = 'entrance' → только audience_entrance_id NOT NULL
//      audience_type = 'unit_type' → только audience_unit_type NOT NULL
//   2. is_urgent=true ⇒ 'web_push' ∈ notify_channels
//   3. notify_channels ⊆ {web_push, sms, telegram, email}
//   4. expires_at IS NULL OR expires_at > starts_at
//   5. published_at NOT NULL ⇒ published_by_staff_id NOT NULL
//
// Идемпотентность publish (§5.3):
//   POST /publish: если published_at IS NOT NULL → 409.  Повторных fan-out'ов
//   нет — каждый announcement публикуется ровно один раз.
//
// Fan-out:
//   - publish с starts_at ≤ now() → enqueueNotificationBatch В ТОЙ ЖЕ ТРАНЗАКЦИИ
//   - publish с starts_at > now() → только UPDATE, fan-out откладывается на
//     cron.  `runScheduledFanout` чекает correlation_id, чтобы не задвоить.

const {
  enqueueNotificationBatch,
} = require('./notificationOutbox');
const { sanitizeMarkdown, sanitizeTitle } = require('./markdownSanitizer');

// ─── Константы спецификации ─────────────────────────────────────────────────
const ALLOWED_CATEGORIES = ['general', 'maintenance', 'event', 'emergency', 'marketing'];
const ALLOWED_AUDIENCE_TYPES = ['all', 'building', 'entrance', 'unit_type'];
const ALLOWED_UNIT_TYPES = ['owner', 'tenant', 'family_member'];
const ALLOWED_CHANNELS = ['web_push', 'sms', 'telegram', 'email'];
// Public API показывает только emergency/maintenance (§4 table, kiosk use-case).
const PUBLIC_CATEGORIES = ['emergency', 'maintenance'];
const ANNOUNCEMENT_EVENT = 'announcement.published';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const BODY_PREVIEW_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

function clampLimit(limit) {
  const n = Number.parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

function trimBodyPreview(md) {
  if (!md) return '';
  return String(md).slice(0, BODY_PREVIEW_MAX);
}

// Колонки, возвращаемые во всех list/get ответах.
const ANNOUNCEMENT_COLUMNS = `
  id, property_id, title, body_md, is_urgent, category,
  audience_type, audience_building_id, audience_entrance_id, audience_unit_type,
  starts_at, expires_at, is_pinned, notify_channels,
  published_at, created_by_staff_id, published_by_staff_id,
  created_at, updated_at, deleted_at
`.trim();

// ─── Валидация input'а ──────────────────────────────────────────────────────
// Единая точка проверки — используется в create + update.  Бросает Error с
// предсказуемым префиксом «invalid », чтобы caller маппил на 400.

function validateAudience(input) {
  const { audienceType = 'all' } = input;
  if (!ALLOWED_AUDIENCE_TYPES.includes(audienceType)) {
    throw new Error(`invalid audience_type '${audienceType}' (allowed: ${ALLOWED_AUDIENCE_TYPES.join(', ')})`);
  }
  if (audienceType === 'all') {
    if (input.audienceBuildingId || input.audienceEntranceId || input.audienceUnitType) {
      throw new Error('invalid audience: audience_type=\'all\' must not set audience_* fields');
    }
    return;
  }
  if (audienceType === 'building') {
    if (!input.audienceBuildingId) throw new Error('invalid audience: audience_building_id required for audience_type=\'building\'');
    if (!isValidUuid(input.audienceBuildingId)) throw new Error('invalid audience_building_id: must be UUID');
    if (input.audienceEntranceId || input.audienceUnitType) {
      throw new Error('invalid audience: only audience_building_id allowed for audience_type=\'building\'');
    }
    return;
  }
  if (audienceType === 'entrance') {
    if (!input.audienceEntranceId) throw new Error('invalid audience: audience_entrance_id required for audience_type=\'entrance\'');
    if (!isValidUuid(input.audienceEntranceId)) throw new Error('invalid audience_entrance_id: must be UUID');
    if (input.audienceBuildingId || input.audienceUnitType) {
      throw new Error('invalid audience: only audience_entrance_id allowed for audience_type=\'entrance\'');
    }
    return;
  }
  if (audienceType === 'unit_type') {
    if (!input.audienceUnitType) throw new Error('invalid audience: audience_unit_type required for audience_type=\'unit_type\'');
    if (!ALLOWED_UNIT_TYPES.includes(input.audienceUnitType)) {
      throw new Error(`invalid audience_unit_type '${input.audienceUnitType}' (allowed: ${ALLOWED_UNIT_TYPES.join(', ')})`);
    }
    if (input.audienceBuildingId || input.audienceEntranceId) {
      throw new Error('invalid audience: only audience_unit_type allowed for audience_type=\'unit_type\'');
    }
  }
}

function validateChannels(channels, isUrgent) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('invalid notify_channels: must be non-empty array');
  }
  for (const c of channels) {
    if (!ALLOWED_CHANNELS.includes(c)) {
      throw new Error(`invalid channel '${c}' (allowed: ${ALLOWED_CHANNELS.join(', ')})`);
    }
  }
  if (isUrgent && !channels.includes('web_push')) {
    throw new Error('invalid notify_channels: is_urgent=true requires web_push');
  }
}

function validateCreateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid input');
  if (!input.propertyId || !isValidUuid(input.propertyId)) {
    throw new Error('invalid property_id: must be UUID');
  }
  if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('invalid title: required');
  }
  if (!input.bodyMd || typeof input.bodyMd !== 'string' || input.bodyMd.trim() === '') {
    throw new Error('invalid body_md: required');
  }
  if (input.category !== undefined && !ALLOWED_CATEGORIES.includes(input.category)) {
    throw new Error(`invalid category '${input.category}' (allowed: ${ALLOWED_CATEGORIES.join(', ')})`);
  }
  validateAudience(input);
  if (input.startsAt !== undefined && input.startsAt !== null) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) throw new Error('invalid starts_at: must be ISO-8601 timestamp');
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) throw new Error('invalid expires_at: must be ISO-8601 timestamp');
  }
  if (input.startsAt && input.expiresAt) {
    if (new Date(input.expiresAt) <= new Date(input.startsAt)) {
      throw new Error('invalid time window: expires_at must be > starts_at');
    }
  }
  const isUrgent = Boolean(input.isUrgent);
  const channels = input.notifyChannels || ['web_push'];
  validateChannels(channels, isUrgent);
  if (input.createdByStaffId !== undefined
      && input.createdByStaffId !== null
      && !isValidUuid(input.createdByStaffId)) {
    throw new Error('invalid created_by_staff_id: must be UUID');
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * listForResident — endpoint GET /api/v1/announcements.
 *
 * Фильтрация:
 *   - deleted_at IS NULL
 *   - published_at IS NOT NULL
 *   - starts_at ≤ now()
 *   - expires_at IS NULL OR expires_at > now()
 *   - audience соответствует резиденту:
 *       audience_type='all' → видно всем
 *       audience_type='building' → unit_id ∈ units(building_id=audience_building_id)
 *       audience_type='entrance' → unit_id ∈ units(entrance_id=audience_entrance_id)
 *       audience_type='unit_type' → residents.resident_type = audience_unit_type
 *
 * resident context: { residentId, unitId, buildingId, entranceId, residentType }
 * (резолвится в router через resolveResidentContext).  Если residentId === null
 * — возвращаем пустой список (legacy юзер без residents-записи).
 */
async function listForResident(db, ctx, opts = {}) {
  if (!ctx || !ctx.residentId) return { rows: [], count: 0 };
  const limit = clampLimit(opts.limit);

  const onlyActive = opts.onlyActive !== false; // default true
  const category = opts.category;

  const params = [ctx.residentId];
  const pieces = [
    'deleted_at IS NULL',
    'published_at IS NOT NULL',
  ];
  if (onlyActive) {
    pieces.push('starts_at <= NOW()');
    pieces.push('(expires_at IS NULL OR expires_at > NOW())');
  }

  // audience filter — одно из 4 совпадений.
  pieces.push(`(
    audience_type = 'all'
    OR (audience_type = 'building' AND audience_building_id = $${params.length + 1})
    OR (audience_type = 'entrance' AND audience_entrance_id = $${params.length + 2})
    OR (audience_type = 'unit_type' AND audience_unit_type = $${params.length + 3})
  )`);
  params.push(ctx.buildingId || null, ctx.entranceId || null, ctx.residentType || null);

  if (category) {
    if (!ALLOWED_CATEGORIES.includes(category)) {
      throw new Error(`invalid category '${category}'`);
    }
    pieces.push(`category = $${params.length + 1}`);
    params.push(category);
  }

  const sql = `
    SELECT ${ANNOUNCEMENT_COLUMNS}
      FROM announcements_v2
     WHERE ${pieces.join(' AND ')}
     ORDER BY is_pinned DESC, is_urgent DESC, starts_at DESC
     LIMIT $${params.length + 1}
  `;
  params.push(limit);
  const { rows } = await db.query(sql, params);
  return { rows, count: rows.length };
}

/**
 * listForAdmin — GET /api/v1/admin/announcements.  Админ видит всё — draft'ы,
 * scheduled, active, expired, soft-deleted (по фильтру).
 *
 * status:
 *   draft      — published_at IS NULL AND deleted_at IS NULL
 *   scheduled  — published_at IS NOT NULL AND starts_at > NOW() AND deleted_at IS NULL
 *   active     — published_at IS NOT NULL AND starts_at ≤ NOW() AND (expires_at IS NULL OR expires_at > NOW())
 *   expired    — published_at IS NOT NULL AND expires_at ≤ NOW()
 *   deleted    — deleted_at IS NOT NULL
 *   (omitted)  — deleted_at IS NULL (все ниже, кроме deleted)
 */
async function listForAdmin(db, propertyId, opts = {}) {
  const limit = clampLimit(opts.limit);
  const params = [propertyId];
  const pieces = ['property_id = $1'];

  const status = opts.status;
  if (status === 'draft') {
    pieces.push('published_at IS NULL AND deleted_at IS NULL');
  } else if (status === 'scheduled') {
    pieces.push('published_at IS NOT NULL AND starts_at > NOW() AND deleted_at IS NULL');
  } else if (status === 'active') {
    pieces.push('published_at IS NOT NULL AND starts_at <= NOW()');
    pieces.push('(expires_at IS NULL OR expires_at > NOW())');
    pieces.push('deleted_at IS NULL');
  } else if (status === 'expired') {
    pieces.push('published_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= NOW()');
    pieces.push('deleted_at IS NULL');
  } else if (status === 'deleted') {
    pieces.push('deleted_at IS NOT NULL');
  } else if (status !== undefined && status !== null && status !== 'all') {
    throw new Error(`invalid status '${status}' (allowed: draft, scheduled, active, expired, deleted, all)`);
  } else {
    // all / undefined — показать всё, включая deleted
  }

  const sql = `
    SELECT ${ANNOUNCEMENT_COLUMNS}
      FROM announcements_v2
     WHERE ${pieces.join(' AND ')}
     ORDER BY is_pinned DESC, COALESCE(published_at, created_at) DESC
     LIMIT $${params.length + 1}
  `;
  params.push(limit);
  const { rows } = await db.query(sql, params);
  return { rows, count: rows.length };
}

/**
 * listPublic — GET /api/v1/public/:slug/announcements.
 *
 * Для kiosk / info-табло: без auth, только `all`-audience + emergency/
 * maintenance категории + активные.
 */
async function listPublic(db, propertyId, opts = {}) {
  const limit = clampLimit(opts.limit);
  const sql = `
    SELECT ${ANNOUNCEMENT_COLUMNS}
      FROM announcements_v2
     WHERE property_id = $1
       AND deleted_at IS NULL
       AND published_at IS NOT NULL
       AND audience_type = 'all'
       AND category = ANY($2::text[])
       AND starts_at <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY is_pinned DESC, is_urgent DESC, starts_at DESC
     LIMIT $3
  `;
  const { rows } = await db.query(sql, [propertyId, PUBLIC_CATEGORIES, limit]);
  return { rows, count: rows.length };
}

/**
 * getById — row detail; caller решает видимость.
 */
async function getById(db, id, opts = {}) {
  if (!isValidUuid(id)) return null;
  const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
  const params = opts.propertyId ? [id, opts.propertyId] : [id];
  const { rows } = await db.query(
    `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements_v2 WHERE id = $1${propertyPredicate}`,
    params,
  );
  return rows[0] || null;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * createAnnouncement — POST /api/v1/announcements.
 *
 * Всегда создаётся как draft (`published_at=NULL`).  Публикация — отдельный
 * endpoint `POST /:id/publish`.  Такое разделение:
 *   - упрощает идемпотентность fan-out'а (публикуется ровно один раз)
 *   - позволяет двум сотрудникам работать над текстом перед отправкой
 */
async function createAnnouncement(db, input) {
  validateCreateInput(input);
  const {
    propertyId,
    title,
    bodyMd,
    isUrgent = false,
    category = 'general',
    audienceType = 'all',
    audienceBuildingId = null,
    audienceEntranceId = null,
    audienceUnitType = null,
    startsAt,
    expiresAt = null,
    isPinned = false,
    notifyChannels = ['web_push'],
    createdByStaffId = null,
  } = input;

  // XSS-guard: strip raw HTML + валидация scheme'ов в markdown-links.
  // См. markdownSanitizer.js.  Warnings НЕ блокируют create — content-spec
  // §7 AC 7.1 требует «transparent sanitization», т.е. мы принимаем input
  // но очищаем до INSERT'а.
  const cleanTitle = sanitizeTitle(title);
  const { sanitized: cleanBody } = sanitizeMarkdown(bodyMd);

  const { rows } = await db.query(
    `INSERT INTO announcements_v2
       (property_id, title, body_md, is_urgent, category,
        audience_type, audience_building_id, audience_entrance_id, audience_unit_type,
        starts_at, expires_at, is_pinned, notify_channels,
        created_by_staff_id)
     VALUES ($1, $2, $3, $4, $5,
             $6, $7, $8, $9,
             COALESCE($10::timestamptz, NOW()), $11, $12, $13,
             $14)
     RETURNING ${ANNOUNCEMENT_COLUMNS}`,
    [
      propertyId, cleanTitle, cleanBody, isUrgent, category,
      audienceType, audienceBuildingId, audienceEntranceId, audienceUnitType,
      startsAt || null, expiresAt, isPinned, notifyChannels,
      createdByStaffId,
    ],
  );
  return rows[0];
}

/**
 * updateAnnouncement — PATCH /api/v1/announcements/:id.
 *
 * Разрешено только пока draft (published_at IS NULL).  После публикации —
 * 409 (§4: «правки только до публикации», исправления — через создание
 * нового объявления с ручной ссылкой).
 */
async function updateAnnouncement(db, id, patch, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  if (!patch || typeof patch !== 'object') {
    return { package: null, conflict: 'noop' };
  }

  const pieces = [];
  const params = [];
  let n = 1;

  // Whitelist только безопасных полей.
  const whitelist = [
    ['title', 'title'],
    ['bodyMd', 'body_md'],
    ['isUrgent', 'is_urgent'],
    ['category', 'category'],
    ['audienceType', 'audience_type'],
    ['audienceBuildingId', 'audience_building_id'],
    ['audienceEntranceId', 'audience_entrance_id'],
    ['audienceUnitType', 'audience_unit_type'],
    ['startsAt', 'starts_at'],
    ['expiresAt', 'expires_at'],
    ['isPinned', 'is_pinned'],
    ['notifyChannels', 'notify_channels'],
  ];

  for (const [jsKey, sqlKey] of whitelist) {
    if (jsKey in patch) {
      pieces.push(`${sqlKey} = $${n}`);
      // XSS-guard на patch пути: sanitize title/bodyMd как в create.
      if (jsKey === 'title') {
        params.push(sanitizeTitle(patch.title));
      } else if (jsKey === 'bodyMd') {
        params.push(sanitizeMarkdown(patch.bodyMd).sanitized);
      } else {
        params.push(patch[jsKey]);
      }
      n += 1;
    }
  }

  if (pieces.length === 0) return { row: null, conflict: 'noop' };

  // Валидация категории и каналов, если они в patch.
  if ('category' in patch && !ALLOWED_CATEGORIES.includes(patch.category)) {
    throw new Error(`invalid category '${patch.category}'`);
  }
  if ('notifyChannels' in patch || 'isUrgent' in patch) {
    // Пересчитываем инвариант is_urgent → web_push с учётом текущего state.
    // Для простоты: если в patch есть и channels, и isUrgent — валидируем их пару.
    // Если только channels — доверяем CHECK constraint.
    if ('notifyChannels' in patch && 'isUrgent' in patch) {
      validateChannels(patch.notifyChannels, Boolean(patch.isUrgent));
    } else if ('notifyChannels' in patch) {
      // Нельзя проверить инвариант без чтения row — оставляем CHECK ловить 23xxx.
      if (!Array.isArray(patch.notifyChannels) || patch.notifyChannels.length === 0) {
        throw new Error('invalid notify_channels: must be non-empty array');
      }
      for (const c of patch.notifyChannels) {
        if (!ALLOWED_CHANNELS.includes(c)) {
          throw new Error(`invalid channel '${c}' (allowed: ${ALLOWED_CHANNELS.join(', ')})`);
        }
      }
    }
  }
  if ('audienceType' in patch
      || 'audienceBuildingId' in patch
      || 'audienceEntranceId' in patch
      || 'audienceUnitType' in patch) {
    // Вся четвёрка должна валидироваться целиком — иначе CHECK поймает поздно.
    // В patch могут быть не все поля; читаем текущее значение и мёрджим.
    // Для простоты: требуем от caller'а передать audienceType при изменении
    // любого audience_* поля.  Если нарушено — 400.
    if (!('audienceType' in patch)) {
      throw new Error('invalid audience: audience_type required when changing audience_* fields');
    }
    validateAudience({
      audienceType: patch.audienceType,
      audienceBuildingId: patch.audienceBuildingId,
      audienceEntranceId: patch.audienceEntranceId,
      audienceUnitType: patch.audienceUnitType,
    });
  }

  params.push(id);
  const idIdx = n;
  if (opts.propertyId) {
    params.push(opts.propertyId);
    n += 1;
  }
  const sql = `
    UPDATE announcements_v2
       SET ${pieces.join(', ')}, updated_at = NOW()
     WHERE id = $${idIdx}
       ${opts.propertyId ? `AND property_id = $${n}` : ''}
       AND deleted_at IS NULL
       AND published_at IS NULL
     RETURNING ${ANNOUNCEMENT_COLUMNS}
  `;
  const { rows } = await db.query(sql, params);
  if (rows.length === 0) {
    // Либо 404, либо уже опубликовано.  Отличить — отдельным SELECT'ом.
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const probeParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: probe } = await db.query(
      `SELECT id, published_at, deleted_at FROM announcements_v2 WHERE id = $1${propertyPredicate}`,
      probeParams,
    );
    if (probe.length === 0) return { row: null, conflict: 'not_found' };
    if (probe[0].deleted_at) return { row: null, conflict: 'deleted' };
    if (probe[0].published_at) return { row: null, conflict: 'already_published' };
    return { row: null, conflict: 'unknown' };
  }
  return { row: rows[0], conflict: null };
}

/**
 * publishAnnouncement — POST /api/v1/announcements/:id/publish.
 *
 * Транзакционно:
 *   1. SELECT FOR UPDATE → валидируем published_at IS NULL и deleted_at IS NULL
 *   2. UPDATE published_at=NOW(), published_by_staff_id=$staffId
 *   3. Если starts_at ≤ NOW() (active сразу) → резолвим audience → fan-out
 *      в outbox (batch) в той же транзакции
 *   4. Если starts_at > NOW() (scheduled) → НЕ fan-out'им; `runScheduledFanout`
 *      подхватит
 *
 * Возврат:
 *   { row, outboxRows, conflict: null | 'not_found' | 'already_published' | 'deleted' }
 *
 * Идемпотентность: повторный publish после уже опубликованного → conflict:
 * 'already_published' (caller → 409).
 */
async function publishAnnouncement(pool, id, staffId, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  if (!isValidUuid(staffId)) throw new Error('invalid staff_id: must be UUID');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      `SELECT ${ANNOUNCEMENT_COLUMNS}
         FROM announcements_v2
        WHERE id = $1${opts.propertyId ? ' AND property_id = $2' : ''}
        FOR UPDATE`,
      opts.propertyId ? [id, opts.propertyId] : [id],
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return { row: null, outboxRows: [], conflict: 'not_found' };
    }
    if (cur[0].deleted_at) {
      await client.query('ROLLBACK');
      return { row: null, outboxRows: [], conflict: 'deleted' };
    }
    if (cur[0].published_at) {
      await client.query('ROLLBACK');
      return { row: null, outboxRows: [], conflict: 'already_published' };
    }

    // UPDATE: ставим published_at/published_by_staff_id атомарно.
    const { rows: upd } = await client.query(
      `UPDATE announcements_v2
          SET published_at = NOW(),
              published_by_staff_id = $2,
              updated_at = NOW()
        WHERE id = $1
          ${opts.propertyId ? 'AND property_id = $3' : ''}
        RETURNING ${ANNOUNCEMENT_COLUMNS}`,
      opts.propertyId ? [id, staffId, opts.propertyId] : [id, staffId],
    );
    const row = upd[0];

    // Fan-out: только если starts_at ≤ now().  scheduled ветку берёт cron.
    const startsAtMs = new Date(row.starts_at).getTime();
    const nowMs = Date.now();
    let outboxRows = [];
    if (startsAtMs <= nowMs) {
      outboxRows = await fanOutAnnouncement(client, row);
    }

    await client.query('COMMIT');
    return { row, outboxRows, conflict: null };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow rollback err */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * unpublishAnnouncement — POST /api/v1/announcements/:id/unpublish.
 *
 * property_admin only.  Ставит published_at=NULL — резиденты перестают
 * видеть.  НЕ отзывает уже отправленные outbox rows (spec §3 «ранее
 * отправленные push/sms остаются доставленными»).
 */
async function unpublishAnnouncement(db, id, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  const { rows } = await db.query(
    `UPDATE announcements_v2
        SET published_at = NULL,
            published_by_staff_id = NULL,
            updated_at = NOW()
      WHERE id = $1
        ${opts.propertyId ? 'AND property_id = $2' : ''}
        AND deleted_at IS NULL
        AND published_at IS NOT NULL
      RETURNING ${ANNOUNCEMENT_COLUMNS}`,
    opts.propertyId ? [id, opts.propertyId] : [id],
  );
  if (rows.length === 0) {
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const probeParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: probe } = await db.query(
      `SELECT id, published_at, deleted_at FROM announcements_v2 WHERE id = $1${propertyPredicate}`,
      probeParams,
    );
    if (probe.length === 0) return { row: null, conflict: 'not_found' };
    if (probe[0].deleted_at) return { row: null, conflict: 'deleted' };
    if (!probe[0].published_at) return { row: null, conflict: 'not_published' };
  }
  return { row: rows[0], conflict: null };
}

/**
 * softDeleteAnnouncement — DELETE /api/v1/announcements/:id.  Ставит
 * deleted_at=NOW().  Ранее опубликованные уведомления остаются в outbox;
 * UI просто перестаёт показывать announcement.
 */
async function softDeleteAnnouncement(db, id, opts = {}) {
  if (!isValidUuid(id)) throw new Error('invalid id: must be UUID');
  const { rows } = await db.query(
    `UPDATE announcements_v2
        SET deleted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        ${opts.propertyId ? 'AND property_id = $2' : ''}
        AND deleted_at IS NULL
      RETURNING ${ANNOUNCEMENT_COLUMNS}`,
    opts.propertyId ? [id, opts.propertyId] : [id],
  );
  if (rows.length === 0) {
    const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
    const probeParams = opts.propertyId ? [id, opts.propertyId] : [id];
    const { rows: probe } = await db.query(
      `SELECT id, deleted_at FROM announcements_v2 WHERE id = $1${propertyPredicate}`,
      probeParams,
    );
    if (probe.length === 0) return { row: null, conflict: 'not_found' };
    return { row: null, conflict: 'already_deleted' };
  }
  return { row: rows[0], conflict: null };
}

/**
 * getReachMetrics — GET /api/v1/admin/announcements/:id/metrics.
 *
 * Join с notification_log_v2 по correlation_id = announcement.id:
 *   - audience_size:      count резидентов в audience (по snapshot времени публикации)
 *   - outbox_count:       count строк в notifications_outbox с correlation_id=id
 *   - log_sent:           count notification_log_v2.status='sent' / 'delivered'
 *   - log_opened:         count с opened_at IS NOT NULL (когда log начнёт отслеживать)
 */
async function getReachMetrics(db, id, opts = {}) {
  if (!isValidUuid(id)) return null;
  const propertyPredicate = opts.propertyId ? ' AND property_id = $2' : '';
  const params = opts.propertyId ? [id, opts.propertyId] : [id];
  const { rows: ann } = await db.query(
    `SELECT id, property_id, audience_type, audience_building_id, audience_entrance_id, audience_unit_type
       FROM announcements_v2
      WHERE id = $1${propertyPredicate}`,
    params,
  );
  if (ann.length === 0) return null;
  const a = ann[0];

  // Audience size — наивный SELECT COUNT из residents с теми же условиями.
  const audSize = await computeAudienceSize(db, a);

  const { rows: outboxCount } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM notifications_outbox
      WHERE correlation_id = $1
        AND property_id = $2`,
    [id, a.property_id],
  );
  const { rows: logCounts } = await db.query(
    `SELECT status, COUNT(*)::int AS n
       FROM notification_log_v2
      WHERE outbox_id IN (
              SELECT id
                FROM notifications_outbox
               WHERE correlation_id = $1
                 AND property_id = $2
            )
        AND property_id = $2
      GROUP BY status`,
    [id, a.property_id],
  );
  const byStatus = Object.fromEntries(logCounts.map((r) => [r.status, r.n]));

  return {
    announcement_id: id,
    audience_size: audSize,
    outbox_count: outboxCount[0]?.n || 0,
    log_sent: byStatus.sent || 0,
    log_delivered: byStatus.delivered || 0,
    log_failed: byStatus.failed || 0,
  };
}

// ─── Cron ───────────────────────────────────────────────────────────────────

/**
 * runScheduledFanout — cron tick (§3).  Для announcements у которых:
 *   published_at IS NOT NULL
 *   starts_at ≤ NOW()
 *   deleted_at IS NULL
 *   нет ни одной строки в notifications_outbox с correlation_id=id
 *
 * Для каждого — резолвит audience, fan-out'ит.  Атомарность per-announcement
 * через transaction + SELECT FOR UPDATE SKIP LOCKED (параллельный cron не
 * задвоит).
 *
 * Возврат: [{ id, outbox_count }] — статистика обработанных.
 */
async function runScheduledFanout(pool, opts = {}) {
  const batchSize = opts.batchSize || 20;
  const stats = [];

  const client = await pool.connect();
  try {
    // Лочим пачку scheduled, готовых к fan-out'у.
    await client.query('BEGIN');
    const { rows: pending } = await client.query(
      `SELECT ${ANNOUNCEMENT_COLUMNS}
         FROM announcements_v2 a
        WHERE a.published_at IS NOT NULL
          AND a.starts_at <= NOW()
          AND a.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications_outbox o
             WHERE o.correlation_id = a.id
          )
        ORDER BY a.starts_at ASC
        LIMIT $1
        FOR UPDATE OF a SKIP LOCKED`,
      [batchSize],
    );

    for (const row of pending) {
      const outboxRows = await fanOutAnnouncement(client, row);
      stats.push({ id: row.id, outbox_count: outboxRows.length });
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
  return stats;
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * fanOutAnnouncement — резолвит audience, кладёт rows в outbox (batch).
 * Вызывается ИСКЛЮЧИТЕЛЬНО изнутри транзакции (tx = client).
 *
 * Возвращает массив вставленных outbox rows.
 */
async function fanOutAnnouncement(tx, row) {
  const recipients = await resolveAudience(tx, row);
  if (recipients.length === 0) return [];

  const payload = {
    announcement_id: row.id,
    title: row.title,
    body_preview: trimBodyPreview(row.body_md),
    is_urgent: row.is_urgent,
    category: row.category,
    deep_link: `/announcements/${row.id}`,
  };

  const paramsList = [];
  for (const r of recipients) {
    for (const channel of row.notify_channels) {
      paramsList.push({
        propertyId: row.property_id,
        eventType: ANNOUNCEMENT_EVENT,
        channel,
        recipientType: 'resident',
        recipientId: r.id,
        payload,
        correlationId: row.id,
      });
    }
  }

  return enqueueNotificationBatch(tx, paramsList);
}

/**
 * resolveAudience — SELECT резидентов под audience_type объявления.
 * Возвращает [{ id }].  Каналы резолвятся downstream adapter'ом из
 * резидентских preferences (push_subscriptions, telegram_links).
 */
async function resolveAudience(tx, row) {
  const propertyId = row.property_id;

  if (row.audience_type === 'all') {
    const { rows } = await tx.query(
      `SELECT id FROM residents WHERE property_id = $1 AND is_active = true`,
      [propertyId],
    );
    return rows;
  }
  if (row.audience_type === 'building') {
    const { rows } = await tx.query(
      `SELECT r.id FROM residents r
         JOIN units u ON u.id = r.unit_id
        WHERE r.property_id = $1
          AND r.is_active = true
          AND u.building_id = $2`,
      [propertyId, row.audience_building_id],
    );
    return rows;
  }
  if (row.audience_type === 'entrance') {
    const { rows } = await tx.query(
      `SELECT r.id FROM residents r
         JOIN units u ON u.id = r.unit_id
        WHERE r.property_id = $1
          AND r.is_active = true
          AND u.entrance_id = $2`,
      [propertyId, row.audience_entrance_id],
    );
    return rows;
  }
  if (row.audience_type === 'unit_type') {
    const { rows } = await tx.query(
      `SELECT id FROM residents
        WHERE property_id = $1
          AND is_active = true
          AND resident_type = $2`,
      [propertyId, row.audience_unit_type],
    );
    return rows;
  }
  return [];
}

/**
 * computeAudienceSize — то же что resolveAudience, но COUNT.  Используется
 * в getReachMetrics; не требует транзакции (pool.query).
 */
async function computeAudienceSize(db, a) {
  if (a.audience_type === 'all') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM residents WHERE property_id = $1 AND is_active = true`,
      [a.property_id],
    );
    return rows[0]?.n || 0;
  }
  if (a.audience_type === 'building') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM residents r
         JOIN units u ON u.id = r.unit_id
        WHERE r.property_id = $1 AND r.is_active = true
          AND u.building_id = $2`,
      [a.property_id, a.audience_building_id],
    );
    return rows[0]?.n || 0;
  }
  if (a.audience_type === 'entrance') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM residents r
         JOIN units u ON u.id = r.unit_id
        WHERE r.property_id = $1 AND r.is_active = true
          AND u.entrance_id = $2`,
      [a.property_id, a.audience_entrance_id],
    );
    return rows[0]?.n || 0;
  }
  if (a.audience_type === 'unit_type') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM residents
        WHERE property_id = $1 AND is_active = true
          AND resident_type = $2`,
      [a.property_id, a.audience_unit_type],
    );
    return rows[0]?.n || 0;
  }
  return 0;
}

// ─── Resident context helpers ───────────────────────────────────────────────

/**
 * resolveResidentContextByUid — возвращает контекст, нужный listForResident.
 * { residentId, unitId, buildingId, entranceId, residentType, propertyId } или null.
 */
async function resolveResidentContextByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT r.id, r.property_id, r.unit_id, r.resident_type,
            u.building_id, u.entrance_id
       FROM residents r
       JOIN units u ON u.id = r.unit_id
      WHERE r.external_uid = $1
        AND r.is_active = true
      LIMIT 1`,
    [uid],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    residentId: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id,
    buildingId: r.building_id,
    entranceId: r.entrance_id,
    residentType: r.resident_type,
  };
}

async function resolveStaffIdByUid(db, uid) {
  if (!uid) return null;
  const { rows } = await db.query(
    `SELECT id FROM staff_users WHERE external_uid = $1 LIMIT 1`,
    [uid],
  );
  return rows[0]?.id || null;
}

async function resolvePropertyIdBySlug(db, slug) {
  if (!slug || typeof slug !== 'string') return null;
  const { rows } = await db.query(
    `SELECT id FROM properties WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0]?.id || null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // constants
  ALLOWED_CATEGORIES,
  ALLOWED_AUDIENCE_TYPES,
  ALLOWED_UNIT_TYPES,
  ALLOWED_CHANNELS,
  PUBLIC_CATEGORIES,
  ANNOUNCEMENT_EVENT,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  // helpers
  clampLimit,
  trimBodyPreview,
  isValidUuid,
  // reads
  listForResident,
  listForAdmin,
  listPublic,
  getById,
  // writes
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
  softDeleteAnnouncement,
  getReachMetrics,
  runScheduledFanout,
  // resolvers
  resolveResidentContextByUid,
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
};
