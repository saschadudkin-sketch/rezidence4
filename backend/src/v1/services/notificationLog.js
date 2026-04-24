'use strict';

// platform-v1 notification_log_v2 read service — Spec: notification-log-v2-spec.md §3.
//
// Этот модуль — чисто READ-сторона для notification_log_v2.  Запись в таблицу
// делает ТОЛЬКО worker через outboxWorker.insertLogV2 (§3.1 spec); любая
// другая точка записи ломает инвариант «один факт доставки = одна строка».
//
// Публичный контракт:
//   listForTenant(db, filters)         — admin list с фильтрами (§3.2)
//   getById(db, id)                    — full-detail row для admin
//   listForResident(db, residentId, opts) — /mine, с trimmed payload
//   getMetrics(db, hoursBack)          — агрегаты success-rate + top events/errors
//   resolveResidentByUid(db, uid)      — helper: legacy users.uid → residents.id
//   trimPayloadForResident(row)        — strips internal fields из payload
//   LIMIT_DEFAULT, LIMIT_MAX           — shared с роутом для валидации

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 500;

// Фильтры, которые ВСЕГДА допустимы в /admin list.  Любой not-in-allowlist
// игнорируется в роуте — здесь на уровне service мы только применяем.
const ALLOWED_CHANNELS = new Set(['web_push', 'sms', 'telegram', 'webhook', 'email']);
const ALLOWED_STATUSES = new Set(['sent', 'failed']);
const ALLOWED_RECIPIENT_TYPES = new Set(['resident', 'staff', 'contractor', 'external']);

// Колонки, возвращаемые в list/byId для admin (full shape).  payload включён —
// support-use-case требует видеть что именно ушло.
const FULL_COLS = `
  id, property_id, outbox_id,
  recipient_type, recipient_id, recipient_address,
  channel, event_type, status, payload,
  error_code, error_message, provider_message_id,
  attempt_count, sent_at, created_at
`;

// Колонки для /mine — без provider_message_id и error_message (они могут
// содержать raw-provider-response с API-ключами или внутренними деталями).
// payload ПОСЛЕ extra-trim через trimPayloadForResident.
const MINE_COLS = `
  id, channel, event_type, status, payload,
  error_code, attempt_count, sent_at, created_at
`;

/**
 * trimPayloadForResident — cuts internal fields from payload before handing
 * to resident /mine.  Inputs we strip:
 *   - subscription_id, endpoint, p256dh, auth  (web-push internals)
 *   - telegram_chat_id, chat_id, bot_token     (TG internals)
 *   - provider-specific headers/config
 *
 * Whitelisted fields пропускаем в ответе:
 *   title, body, url, locale, action, icon
 *
 * Причина whitelist > blacklist: payload'ы варьируются по event_type; новый
 * adapter может добавить тех-поле, которое мы забудем blacklist'нуть.
 * Whitelist гарантирует leakage-free default.
 */
function trimPayloadForResident(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const ALLOW = ['title', 'body', 'url', 'locale', 'action', 'icon', 'message'];
  const out = {};
  for (const key of ALLOW) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

function clampLimit(raw, defaultVal = LIMIT_DEFAULT) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(Math.floor(n), LIMIT_MAX);
}

function isValidIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/**
 * listForTenant — основной admin-list query.  Фильтры (все optional):
 *   recipient_type, recipient_id, channel, event_type, status, since, until
 *
 * Bounds & safety:
 *   - since/until — ISO-8601 строки; если заданы обе, since <= until валидируется
 *     в роуте (здесь просто фильтруем >= since и <= until).
 *   - если recipient_id НЕ задан И since НЕ задан → по-умолчанию последние 30 дней
 *     (предохранитель от full-scan).  Роут может требовать since/until явно —
 *     это его дело.
 *   - limit клампится в [1, LIMIT_MAX]; default LIMIT_DEFAULT.
 *   - offset >= 0.
 *
 * Порядок: created_at DESC — свежие первыми.  Индексы idx_..._property_time
 * и idx_..._recipient (см. миграцию 017) покрывают оба сценария.
 */
async function listForTenant(db, filters = {}) {
  const clauses = [];
  const args = [];

  if (filters.recipient_type && ALLOWED_RECIPIENT_TYPES.has(filters.recipient_type)) {
    args.push(filters.recipient_type);
    clauses.push(`recipient_type = $${args.length}`);
  }
  if (filters.recipient_id) {
    args.push(filters.recipient_id);
    clauses.push(`recipient_id = $${args.length}`);
  }
  if (filters.channel && ALLOWED_CHANNELS.has(filters.channel)) {
    args.push(filters.channel);
    clauses.push(`channel = $${args.length}`);
  }
  if (filters.event_type) {
    args.push(filters.event_type);
    clauses.push(`event_type = $${args.length}`);
  }
  if (filters.status && ALLOWED_STATUSES.has(filters.status)) {
    args.push(filters.status);
    clauses.push(`status = $${args.length}`);
  }
  if (filters.since && isValidIso(filters.since)) {
    args.push(filters.since);
    clauses.push(`created_at >= $${args.length}`);
  }
  if (filters.until && isValidIso(filters.until)) {
    args.push(filters.until);
    clauses.push(`created_at <= $${args.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));

  args.push(limit);
  args.push(offset);
  const sql =
    `SELECT ${FULL_COLS}
       FROM notification_log_v2
       ${where}
      ORDER BY created_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`;

  const { rows } = await db.query(sql, args);
  return { rows, limit, offset };
}

/**
 * getById — single-row lookup.  Возвращает null если не найдено.
 * Тенант-скопинг обеспечивается per-tenant DB (нет глобальной таблицы).
 */
async function getById(db, id) {
  const { rows } = await db.query(
    `SELECT ${FULL_COLS} FROM notification_log_v2 WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * listForResident — /mine вариант.  Всегда:
 *   - recipient_type = 'resident'
 *   - recipient_id = $1 (passed residentId)
 *   - status = 'sent' (spec §7.Q7 — резидент не видит failed)
 *   - payload обрезан trimPayloadForResident'ом
 *   - provider_message_id и error_message НЕ возвращаются
 *
 * Примечание: status='sent' — статический фильтр, не из filters; резидент
 * физически не может задать status='failed'.
 */
async function listForResident(db, residentId, opts = {}) {
  if (!residentId) return [];
  const limit = clampLimit(opts.limit);
  const { rows } = await db.query(
    `SELECT ${MINE_COLS}
       FROM notification_log_v2
      WHERE recipient_type = 'resident'
        AND recipient_id = $1
        AND status = 'sent'
      ORDER BY created_at DESC
      LIMIT $2`,
    [residentId, limit],
  );
  return rows.map((r) => ({ ...r, payload: trimPayloadForResident(r.payload) }));
}

/**
 * resolveResidentByUid — lookup residents.id по legacy users.uid.  Используется
 * в /mine, т.к. JWT содержит только `uid` (TEXT из legacy users table), а
 * notification_log_v2.recipient_id — UUID из residents.id.  Bridge: миграция
 * 004 создала `residents.external_uid` UNIQUE именно для этого случая.
 *
 * Возвращает UUID string либо null — NULL значит резидент ещё не зарегистрирован
 * в property-scoped residents (pre-Phase-7 legacy user); роут должен вернуть
 * пустой список, не 404 (у него нет истории уведомлений).
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
 * getMetrics — агрегаты за `hoursBack` часов (24 / 168 / 720 = 24h/7d/30d).
 * Spec §3.2: admin endpoint возвращает success-rate per-channel, top event_types,
 * top errors.  Три отдельных запроса — не склеиваем в один monster-CTE потому
 * что индексы разные:
 *   - channel: idx_..._channel_status(property_id, channel, status, created_at)
 *   - event_type: idx_..._event(property_id, event_type, created_at)
 *   - errors (по error_code): covering index по (property_id, created_at) + filter
 *
 * Возвращает снимок:
 *   {
 *     period_hours, generated_at,
 *     channels: [{channel, sent, failed, success_rate}],
 *     top_events: [{event_type, total}],
 *     top_errors: [{error_code, total}],
 *   }
 *
 * success_rate — фракция [0..1], null когда нет данных (деление на 0).
 */
async function getMetrics(db, hoursBack) {
  const hours = Number(hoursBack);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new TypeError('hoursBack must be positive number');
  }
  const generatedAt = new Date().toISOString();
  const sinceClause = `created_at >= NOW() - $1::interval`;
  const intervalArg = `${Math.floor(hours)} hours`;

  // Per-channel sent/failed counts.
  const { rows: chRows } = await db.query(
    `SELECT channel,
            COUNT(*) FILTER (WHERE status='sent')   AS sent,
            COUNT(*) FILTER (WHERE status='failed') AS failed
       FROM notification_log_v2
      WHERE ${sinceClause}
      GROUP BY channel
      ORDER BY channel`,
    [intervalArg],
  );
  const channels = chRows.map((r) => {
    const sent = Number(r.sent) || 0;
    const failed = Number(r.failed) || 0;
    const total = sent + failed;
    return {
      channel: r.channel,
      sent,
      failed,
      success_rate: total === 0 ? null : sent / total,
    };
  });

  // Top event types by volume (cap 10 — dashboard-friendly).
  const { rows: evRows } = await db.query(
    `SELECT event_type, COUNT(*)::int AS total
       FROM notification_log_v2
      WHERE ${sinceClause}
      GROUP BY event_type
      ORDER BY total DESC
      LIMIT 10`,
    [intervalArg],
  );
  const top_events = evRows.map((r) => ({
    event_type: r.event_type,
    total: Number(r.total) || 0,
  }));

  // Top error codes — только для failed.  Если всё успешно — пустой массив.
  const { rows: errRows } = await db.query(
    `SELECT error_code, COUNT(*)::int AS total
       FROM notification_log_v2
      WHERE ${sinceClause}
        AND status = 'failed'
        AND error_code IS NOT NULL
      GROUP BY error_code
      ORDER BY total DESC
      LIMIT 10`,
    [intervalArg],
  );
  const top_errors = errRows.map((r) => ({
    error_code: r.error_code,
    total: Number(r.total) || 0,
  }));

  return {
    period_hours: hours,
    generated_at: generatedAt,
    channels,
    top_events,
    top_errors,
  };
}

module.exports = {
  listForTenant,
  getById,
  listForResident,
  resolveResidentByUid,
  getMetrics,
  trimPayloadForResident,
  clampLimit,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  ALLOWED_CHANNELS,
  ALLOWED_STATUSES,
  ALLOWED_RECIPIENT_TYPES,
};
