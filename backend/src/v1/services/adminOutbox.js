'use strict';

// platform-v1 admin/outbox observability service — Spec: notifications-outbox-spec.md §4.2.
// Фаза: 5 (Content + Notifications).
//
// Этот модуль — ЧИСТО per-property observability сервис поверх `notifications_outbox`.
// Write-сторона outbox (producer / worker / resurrect) живёт в:
//   • notificationOutbox.js — enqueue producer (tx-scoped)
//   • outboxWorker.js       — pending → in_flight → sent/failed/dead
//   • outboxRetry.js        — resurrectOutboxRows для bulk re-queue
//
// Что делает adminOutbox:
//   • listOutbox(db, filters)        — фильтруемый list для admin UI
//   • getOutboxById(db, id)          — single-row detail
//   • requeueOutboxRow(db, id)       — single-row force-retry (thin wrapper)
//   • cancelOutboxRow(db, id)        — pending/failed → dead вручную
//   • getOutboxMetrics(db)           — snapshot gauges (counts + per-channel)
//   • renderMetricsAsPrometheus(m)   — text/plain exposition для Prometheus
//
// Безопасность/контракт:
//   • Все функции — БЕЗ `property_id` аргумента: multi-tenant изоляция держится
//     на уровне pg pool (per-property DB).  Добавление property_id здесь
//     дублирует фильтр и риск рассогласования.
//   • Cancel гейтится через WHERE status IN ('pending','failed') — sent и dead
//     нельзя cancel'нуть (sent финальный; dead уже терминал).  in_flight
//     cancel мы тоже не делаем, чтобы не двойнить: worker как раз обрабатывает.
//   • Requeue использует resurrectOutboxRows({ids:[id]}) — тот же гардинг
//     (только из dead/failed).  pending/in_flight/sent просто не попадут
//     под UPDATE — caller видит это по revivedIds.length.

const { resurrectOutboxRows } = require('./outboxRetry');

// ─── Константы ───────────────────────────────────────────────────────────────

const LIMIT_DEFAULT = 100;
const LIMIT_MAX     = 500;

// Whitelist'ы — ровно те же enum'ы, что в миграции 016 и в notificationOutbox.js.
// Дублирую здесь (а не импортирую), чтобы один чистый контракт adminOutbox
// не зависел от producer'а.  Если сдвинется — тесты упадут в обоих местах.
const ALLOWED_STATUSES = new Set([
  'pending', 'in_flight', 'sent', 'failed', 'dead',
]);
const ALLOWED_CHANNELS = new Set([
  'web_push', 'sms', 'telegram', 'webhook', 'email',
]);

// Все каналы перечисляю ЯВНО (не беру keys из Set) — порядок в Prometheus
// exposition должен быть стабильным для diff-friendly scrape-log'ов.
const CHANNELS_ORDERED = ['web_push', 'sms', 'telegram', 'webhook', 'email'];
const STATUSES_ORDERED = ['pending', 'in_flight', 'sent', 'failed', 'dead'];

// Колонки, возвращаемые /admin/outbox list и /:id detail.  Включаем payload —
// admin support-case требует видеть, что именно отправлялось.  НЕ включаем
// recipient_address full — но поскольку per-tenant DB уже под admin-auth,
// PII утечки за границу tenant'а не будет.
const OUTBOX_COLUMNS = `
  id, property_id, event_type, channel,
  recipient_type, recipient_id, recipient_address,
  payload, status, attempt_count, max_attempts,
  next_attempt_at, last_attempted_at, last_error,
  sent_at, correlation_id, created_at
`;

// UUID regex — используется для id-аргументов в /:id ручках.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

function isValidIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function clampLimit(raw, defaultVal = LIMIT_DEFAULT) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(Math.floor(n), LIMIT_MAX);
}

// ─── listOutbox ──────────────────────────────────────────────────────────────

/**
 * listOutbox — filtered list для admin UI.
 *
 * Фильтры (все optional):
 *   status    ∈ ALLOWED_STATUSES (иначе игнорируется, не 400 — защита от typos)
 *   channel   ∈ ALLOWED_CHANNELS
 *   from/to   — ISO-8601, фильтрует created_at >= from AND <= to
 *   q         — текстовый поиск по event_type ILIKE '%q%' OR correlation_id::text
 *               OR recipient_address ILIKE '%q%'.  Подстрочный, чтобы support мог
 *               найти уведомление по куску номера телефона или slug'у события.
 *   limit     — [1..LIMIT_MAX], default LIMIT_DEFAULT
 *   offset    — >= 0
 *
 * Порядок: created_at DESC — свежие первыми.  Индекс
 * idx_notifications_outbox_property_time покрывает scan.
 *
 * Возвращает { rows, limit, offset } — shape совпадает с notificationLog.listForTenant
 * для UI-единообразия.
 */
async function listOutbox(db, filters = {}) {
  const clauses = [];
  const args    = [];

  if (filters.status && ALLOWED_STATUSES.has(filters.status)) {
    args.push(filters.status);
    clauses.push(`status = $${args.length}`);
  }
  if (filters.channel && ALLOWED_CHANNELS.has(filters.channel)) {
    args.push(filters.channel);
    clauses.push(`channel = $${args.length}`);
  }
  if (filters.from && isValidIso(filters.from)) {
    args.push(filters.from);
    clauses.push(`created_at >= $${args.length}`);
  }
  if (filters.to && isValidIso(filters.to)) {
    args.push(filters.to);
    clauses.push(`created_at <= $${args.length}`);
  }
  if (filters.q && typeof filters.q === 'string' && filters.q.trim()) {
    // ILIKE pattern — безопасен (pg экранирует аргумент); но обрезаем длину,
    // чтобы не было ReDoS-подобных проблем на стороне клиента.
    const pat = `%${filters.q.trim().slice(0, 200)}%`;
    args.push(pat);
    // correlation_id — UUID, ILIKE по нему работает через ::text cast.
    // recipient_id — тоже UUID, но его в q-поиске не даём (support ищет
    // по адресу/событию, не по id).
    clauses.push(
      `(event_type ILIKE $${args.length} `
      + `OR correlation_id::text ILIKE $${args.length} `
      + `OR recipient_address ILIKE $${args.length})`,
    );
  }

  const where  = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit  = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));

  args.push(limit);
  args.push(offset);
  const sql = `
    SELECT ${OUTBOX_COLUMNS}
      FROM notifications_outbox
      ${where}
     ORDER BY created_at DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}
  `;

  const { rows } = await db.query(sql, args);
  return { rows, limit, offset };
}

// ─── getOutboxById ───────────────────────────────────────────────────────────

/**
 * getOutboxById — single-row detail.
 *
 * Возвращает null, если не найдено.  id-валидация — уровень роута (UUID guard);
 * сервис сам invalid-id просто не найдёт.
 */
async function getOutboxById(db, id) {
  const { rows } = await db.query(
    `SELECT ${OUTBOX_COLUMNS} FROM notifications_outbox WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

// ─── requeueOutboxRow ────────────────────────────────────────────────────────

/**
 * requeueOutboxRow — single-row force-retry.  Тонкая обёртка над
 * resurrectOutboxRows({ ids: [id] }) из outboxRetry.js — переиспользуем
 * уже-задокументированный гардинг (только dead/failed → pending с reset'ом
 * attempt_count=0, last_error=NULL).
 *
 * Возвращает:
 *   { revived: true, id }           — строка реально сменила статус
 *   { revived: false, conflict }   — conflict ∈ { 'not_found' | 'not_retryable' }
 *
 * not_found ≠ not_retryable:
 *   • not_found  — row.id вообще нет в таблице
 *   • not_retryable — row есть, но status ∈ {pending, in_flight, sent}
 *
 * Мы делаем два запроса: сначала exists-check, потом resurrect.  Это важно,
 * потому что resurrect возвращает revivedIds=[] и в случае not_found, и в
 * случае not_retryable — без detail-check caller не отличит их.
 */
async function requeueOutboxRow(db, id) {
  const existing = await getOutboxById(db, id);
  if (!existing) return { revived: false, conflict: 'not_found' };

  const out = await resurrectOutboxRows(db, { ids: [id] });
  if (out.revivedIds.includes(id)) {
    return { revived: true, id, previousStatus: existing.status };
  }
  // Строка есть, но не dead/failed — resurrect её не тронул.
  return { revived: false, conflict: 'not_retryable', status: existing.status };
}

// ─── cancelOutboxRow ─────────────────────────────────────────────────────────

/**
 * cancelOutboxRow — manual pending/failed → dead.
 *
 * Зачем: админ знает, что уведомление уже неактуально («заявка отменена, но
 * pending-push про подтверждение ещё не отправили»).  Одной кнопкой
 * переводит в dead, чтобы worker её не брал.
 *
 * Гардинг — WHERE status IN ('pending','failed').  Попытка cancel'нуть sent
 * (уже отправлено) или dead (уже мертво) или in_flight (worker обрабатывает
 * прямо сейчас) возвращает conflict, а не ошибку.
 *
 * Важно: строка, после cancel, неотличима от той, что «умерла сама» по
 * max_attempts — чтобы admin-UI unified.  last_error помечаем как
 * 'cancelled_by_admin', чтобы audit было видно ПОЧЕМУ она dead.
 */
async function cancelOutboxRow(db, id) {
  const { rows } = await db.query(
    `UPDATE notifications_outbox
        SET status     = 'dead',
            last_error = 'cancelled_by_admin',
            last_attempted_at = NOW()
      WHERE id = $1
        AND status IN ('pending','failed')
      RETURNING ${OUTBOX_COLUMNS}`,
    [id],
  );
  if (rows.length === 0) {
    // Отличаем not_found от not_cancellable (sent/dead/in_flight).
    const existing = await getOutboxById(db, id);
    if (!existing) return { cancelled: false, conflict: 'not_found' };
    return {
      cancelled: false,
      conflict: 'not_cancellable',
      status: existing.status,
    };
  }
  return { cancelled: true, row: rows[0] };
}

// ─── getOutboxMetrics ────────────────────────────────────────────────────────

/**
 * getOutboxMetrics — DB-level snapshot для monitoring dashboards.
 *
 * Не путать с `/api/metrics/prometheus` (registerObservabilityRoutes.js):
 *   • /api/metrics/prometheus — process-level counters (инкремент при каждой
 *     отправке worker'ом; сбрасывается при restart).
 *   • admin/outbox/metrics    — DB-level gauges (текущее состояние очереди;
 *     переживает restart, не зависит от in-process state).
 *
 * Возвращает:
 *   {
 *     counts:         { pending, in_flight, sent, failed, dead }  -- total rows по status
 *     per_channel:    [{ channel, pending, in_flight, sent, failed, dead }]  -- breakdown
 *     per_event_type: [{ event_type, total }]  -- top-10 event_types
 *     oldest_pending_age_seconds:  number | null    -- MIN(next_attempt_at) для pending|failed
 *     generated_at:   ISO string
 *   }
 *
 * Три отдельных запроса — не один CTE:
 *   1. aggregate counts + oldest (idx_..._worker_queue partial)
 *   2. per-channel breakdown (seq scan acceptable — 5 каналов)
 *   3. top events (idx_..._property_time + GROUP BY event_type)
 */
async function getOutboxMetrics(db) {
  const generatedAt = new Date().toISOString();

  // 1. Глобальные counts per-status + oldest_pending.
  const { rows: aggRows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
      COUNT(*) FILTER (WHERE status = 'in_flight') AS in_flight,
      COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
      COUNT(*) FILTER (WHERE status = 'dead')      AS dead,
      EXTRACT(EPOCH FROM (NOW() - MIN(next_attempt_at))
        FILTER (WHERE status IN ('pending','failed'))) AS oldest_pending_age_seconds
      FROM notifications_outbox
  `);
  const agg = aggRows[0] || {};

  // 2. Per-channel breakdown.  Заполняем ВСЕ каналы (включая нулевые) —
  // Prometheus-consumer ожидает стабильный набор label values.
  const { rows: chRows } = await db.query(`
    SELECT channel,
           COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
           COUNT(*) FILTER (WHERE status = 'in_flight') AS in_flight,
           COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) FILTER (WHERE status = 'dead')      AS dead
      FROM notifications_outbox
     GROUP BY channel
  `);
  const chByName = new Map();
  for (const r of chRows) chByName.set(r.channel, r);
  const perChannel = CHANNELS_ORDERED.map((name) => {
    const r = chByName.get(name) || {};
    return {
      channel:   name,
      pending:   Number(r.pending)   || 0,
      in_flight: Number(r.in_flight) || 0,
      sent:      Number(r.sent)      || 0,
      failed:    Number(r.failed)    || 0,
      dead:      Number(r.dead)      || 0,
    };
  });

  // 3. Top event_types — top-10 по volume.  Bounded в LIMIT 10, чтобы
  // dashboard-friendly.
  const { rows: evRows } = await db.query(`
    SELECT event_type, COUNT(*)::int AS total
      FROM notifications_outbox
     GROUP BY event_type
     ORDER BY total DESC
     LIMIT 10
  `);
  const perEventType = evRows.map((r) => ({
    event_type: r.event_type,
    total:      Number(r.total) || 0,
  }));

  return {
    counts: {
      pending:   Number(agg.pending)   || 0,
      in_flight: Number(agg.in_flight) || 0,
      sent:      Number(agg.sent)      || 0,
      failed:    Number(agg.failed)    || 0,
      dead:      Number(agg.dead)      || 0,
    },
    per_channel: perChannel,
    per_event_type: perEventType,
    oldest_pending_age_seconds:
      agg.oldest_pending_age_seconds == null
        ? null
        : Math.round(Number(agg.oldest_pending_age_seconds)),
    generated_at: generatedAt,
  };
}

// ─── renderMetricsAsPrometheus ───────────────────────────────────────────────

/**
 * renderMetricsAsPrometheus — превращает snapshot getOutboxMetrics() в
 * Prometheus text-exposition format (v0.0.4).
 *
 * Пример вывода:
 *
 *   # HELP notifications_outbox_pending Number of outbox rows in pending state
 *   # TYPE notifications_outbox_pending gauge
 *   notifications_outbox_pending{channel="web_push",property="zamosk"} 4
 *   notifications_outbox_pending{channel="sms",property="zamosk"} 2
 *   ...
 *   # HELP notifications_outbox_oldest_pending_age_seconds ...
 *   # TYPE notifications_outbox_oldest_pending_age_seconds gauge
 *   notifications_outbox_oldest_pending_age_seconds{property="zamosk"} 142
 *
 * Label `property` — snapshot slug'а от caller'а (роут получает его из
 * req.property.slug либо заполняет пустым, если middleware не раскрыл).
 * Prometheus-scraper идентифицирует tenant через этот label в `rollup`
 * dashboard'ах.
 *
 * @param {object} metrics — объект из getOutboxMetrics(db)
 * @param {object} [opts]
 * @param {string} [opts.propertySlug] — значение label property="..."
 * @returns {string} text/plain body, всегда заканчивается `\n`
 */
function renderMetricsAsPrometheus(metrics, opts = {}) {
  const propertyLabel = typeof opts.propertySlug === 'string' && opts.propertySlug
    ? `,property="${escapeLabel(opts.propertySlug)}"`
    : '';

  const lines = [];

  // Per-status gauge families.  Для каждого status генерируем свою метрику,
  // per-channel breakdown через label `channel`.  Это не самый компактный
  // подход (можно было одну метрику с (channel,status) labels), но он ближе
  // к формату, который зашёл в spec §4.2: `notifications_outbox_pending{channel,property}`.
  for (const status of STATUSES_ORDERED) {
    const metricName = `notifications_outbox_${status}`;
    lines.push(`# HELP ${metricName} Number of outbox rows in ${status} state`);
    lines.push(`# TYPE ${metricName} gauge`);
    for (const ch of metrics.per_channel) {
      const value = ch[status] || 0;
      lines.push(
        `${metricName}{channel="${escapeLabel(ch.channel)}"${propertyLabel}} ${value}`,
      );
    }
  }

  // Oldest pending age — scalar gauge per-property (без channel label).
  {
    const name = 'notifications_outbox_oldest_pending_age_seconds';
    lines.push(`# HELP ${name} Age in seconds of the oldest pending/failed row`);
    lines.push(`# TYPE ${name} gauge`);
    const val = metrics.oldest_pending_age_seconds == null
      ? 0  // Prometheus не любит NaN; 0 значит «очередь пуста»
      : metrics.oldest_pending_age_seconds;
    // Лейбл property всё равно нужен, чтобы rollup был возможен.
    const propOnly = propertyLabel ? `{${propertyLabel.slice(1)}}` : '';
    lines.push(`${name}${propOnly} ${val}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * escapeLabel — label values в Prometheus экранируют `\`, `"`, `\n`.
 * Безопасно для slug'ов (обычно [a-z0-9-]), но выполняем для foolproofness.
 */
function escapeLabel(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

module.exports = {
  // DB query helpers
  listOutbox,
  getOutboxById,
  requeueOutboxRow,
  cancelOutboxRow,
  getOutboxMetrics,
  // Exposition helpers
  renderMetricsAsPrometheus,
  escapeLabel,
  // Utilities
  clampLimit,
  isValidUuid,
  isValidIso,
  // Constants (tests + route validation)
  LIMIT_DEFAULT,
  LIMIT_MAX,
  ALLOWED_STATUSES,
  ALLOWED_CHANNELS,
  CHANNELS_ORDERED,
  STATUSES_ORDERED,
  OUTBOX_COLUMNS,
};
