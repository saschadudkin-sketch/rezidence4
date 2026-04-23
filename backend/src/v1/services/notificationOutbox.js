'use strict';

// platform-v1 notifications-outbox producer — Spec: notifications-outbox-spec.md §4.1.
// Phase: 5 (Content + Notifications).
//
// Единственная обязанность сервиса — записать одну (или batch) строку в
// `notifications_outbox` В ТОЙ ЖЕ транзакции, в которой уже идёт бизнес-мутация.
// Сам канал здесь не вызывается — это делает worker, читая `status='pending'`.
//
// Выбор сигнатуры: первый параметр `tx` — pg client, не pool.  Если вызывающий
// код передаст pool, атомарность с бизнес-мутацией потеряется, поэтому helper
// явно проверяет наличие `.query`, но не принимает pool-подобные объекты без
// текущей транзакции.  См. spec §4.1 «Правила использования».
//
// Feature-flag:
//   NOTIFICATIONS_OUTBOX_ENABLED=true  → producer используется
//   NOTIFICATIONS_OUTBOX_ENABLED=false (default) → caller должен оставаться
//     в legacy inline-path (см. notificationService.dispatch)
// `isOutboxEnabled()` экспортируется для централизованной проверки.  Сам
// producer не читает флаг — он просто INSERT'ит.  Решение «писать или нет»
// принимает caller (wrapper вокруг notificationService, см. Фаза 5 BACKLOG).

const VALID_CHANNELS = new Set([
  'web_push', 'sms', 'telegram', 'webhook', 'email',
]);

const VALID_RECIPIENT_TYPES = new Set([
  'resident', 'staff', 'contractor', 'vehicle', 'external',
]);

// Усиленная параметризация backoff (мин) — закреплено spec §3.
// Worker использует те же значения; producer их не вызывает, но
// экспортирует для консистентности в тестах и admin-API.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 1440];

// Максимум попыток (spec §2: default 6) — суммарно ~29 часов.
const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * @typedef {Object} EnqueueParams
 * @property {string} propertyId       UUID property_id (multi-tenant scope)
 * @property {string} eventType        e.g. 'guest.arrived', 'request.approved'
 * @property {string} channel          ∈ VALID_CHANNELS
 * @property {string} recipientType    ∈ VALID_RECIPIENT_TYPES
 * @property {?string} recipientId     UUID (optional, snapshot resolution)
 * @property {?string} recipientAddress phone/endpoint/chat_id snapshot
 * @property {Object}  payload         { title, body, url?, ... } — stored JSONB
 * @property {?string} correlationId   UUID (бизнес-сущность: pass_id, request_id)
 * @property {?number} maxAttempts     override default 6
 */

/**
 * validateParams — бросает Error при невалидных данных до SQL.
 * Отдельная функция, чтобы одинаково работать для single + batch enqueue.
 */
function validateParams(p) {
  if (!p || typeof p !== 'object') {
    throw new Error('enqueueNotification: params object required');
  }
  if (!p.propertyId) throw new Error('enqueueNotification: propertyId required');
  if (!p.eventType) throw new Error('enqueueNotification: eventType required');
  if (!VALID_CHANNELS.has(p.channel)) {
    throw new Error(`enqueueNotification: invalid channel '${p.channel}'`);
  }
  if (!VALID_RECIPIENT_TYPES.has(p.recipientType)) {
    throw new Error(
      `enqueueNotification: invalid recipientType '${p.recipientType}'`,
    );
  }
  if (p.payload === undefined || p.payload === null) {
    throw new Error('enqueueNotification: payload required');
  }
  if (typeof p.payload !== 'object') {
    throw new Error('enqueueNotification: payload must be object');
  }
  if (p.maxAttempts !== undefined
      && (!Number.isInteger(p.maxAttempts) || p.maxAttempts <= 0)) {
    throw new Error('enqueueNotification: maxAttempts must be positive integer');
  }
}

function assertTx(tx) {
  if (!tx || typeof tx.query !== 'function') {
    throw new Error(
      'enqueueNotification: first arg must be a pg client (tx).  '
      + 'Passing a pool breaks outbox atomicity (see spec §4.1).',
    );
  }
}

/**
 * enqueueNotification — single-row producer.
 *
 * @param {{query: Function}} tx pg client already in BEGIN
 * @param {EnqueueParams} params
 * @returns {Promise<{id: string, status: 'pending', next_attempt_at: string}>}
 */
async function enqueueNotification(tx, params) {
  assertTx(tx);
  validateParams(params);

  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const { rows } = await tx.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type,
        recipient_id, recipient_address, payload,
        status, attempt_count, max_attempts, next_attempt_at,
        correlation_id)
     VALUES ($1, $2, $3, $4,
             $5, $6, $7,
             'pending', 0, $8, NOW(),
             $9)
     RETURNING id, status, next_attempt_at, created_at`,
    [
      params.propertyId,
      params.eventType,
      params.channel,
      params.recipientType,
      params.recipientId || null,
      params.recipientAddress || null,
      JSON.stringify(params.payload),
      maxAttempts,
      params.correlationId || null,
    ],
  );

  return rows[0];
}

/**
 * enqueueNotificationBatch — fan-out в одну транзакцию.  Для событий вида
 * `announcement.published` (500+ резидентов) — см. spec §7 Q3.
 *
 * Возвращает массив { id } в порядке входа; пустой массив не делает INSERT.
 * Postgres ограничение: ~65535 параметров / 9 колонок ≈ 7281 строк/batch.
 * Для Замоскворечья (~500 квартир) — 1 batch с запасом.
 */
async function enqueueNotificationBatch(tx, paramsList) {
  assertTx(tx);
  if (!Array.isArray(paramsList)) {
    throw new Error('enqueueNotificationBatch: paramsList must be array');
  }
  if (paramsList.length === 0) return [];
  paramsList.forEach(validateParams);

  // Build multi-row VALUES ($1,$2,...), ($10,$11,...), ...
  const cols = 9; // без status/attempt_count/next_attempt_at — у них дефолты
  const valuesSql = paramsList
    .map((_, i) => {
      const base = i * cols;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, `
           + `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    })
    .join(', ');

  const values = [];
  for (const p of paramsList) {
    values.push(
      p.propertyId,
      p.eventType,
      p.channel,
      p.recipientType,
      p.recipientId || null,
      p.recipientAddress || null,
      JSON.stringify(p.payload),
      p.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      p.correlationId || null,
    );
  }

  const { rows } = await tx.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type,
        recipient_id, recipient_address, payload,
        max_attempts, correlation_id)
     VALUES ${valuesSql}
     RETURNING id`,
    values,
  );
  return rows;
}

/**
 * isOutboxEnabled — централизованная проверка feature-flag'а.
 * Env var `NOTIFICATIONS_OUTBOX_ENABLED` читается on-demand (а не кэшируется
 * в module-scope), чтобы тесты могли переключать поведение через
 * process.env без перезагрузки модуля.
 *
 * Значения «true»: 'true' | '1' | 'yes' | 'on' (case-insensitive).
 * Всё остальное (undefined, 'false', '0', пустая строка, случайная строка)
 * → false.  Cut-over default — legacy inline path.
 */
function isOutboxEnabled() {
  const raw = process.env.NOTIFICATIONS_OUTBOX_ENABLED;
  if (!raw) return false;
  return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase());
}

/**
 * computeBackoffMinutes — используется worker'ом, но экспорт здесь, чтобы
 * один модуль владел state-machine константами.  `attemptCount` — количество
 * УЖЕ сделанных попыток (0-based): attemptCount=0 → первая попытка после
 * enqueue сразу, attemptCount=1 → через BACKOFF_MINUTES[0] = 1 минуту и т.д.
 * Возвращает null, если превышен лимит (caller помечает dead).
 */
function computeBackoffMinutes(attemptCount) {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new Error('computeBackoffMinutes: attemptCount must be non-negative integer');
  }
  if (attemptCount === 0) return 0;         // ready immediately after enqueue
  const idx = attemptCount - 1;
  if (idx >= BACKOFF_MINUTES.length) return null;
  return BACKOFF_MINUTES[idx];
}

module.exports = {
  enqueueNotification,
  enqueueNotificationBatch,
  isOutboxEnabled,
  computeBackoffMinutes,
  // exported for tests + admin-API introspection:
  VALID_CHANNELS,
  VALID_RECIPIENT_TYPES,
  BACKOFF_MINUTES,
  DEFAULT_MAX_ATTEMPTS,
};
