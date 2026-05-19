'use strict';

// platform-v1 notifications-outbox force-retry — Spec: notifications-outbox-spec.md §4.5
// (operator escape-hatch).
//
// Зачем:
//   Нормальный путь: worker сам ретраит failed-строки согласно backoff'у, а
//   после max_attempts (default 6) переводит в `dead`.  Если дохлый канал
//   починили (например, Telegram API вернулся, или перегенерировали VAPID
//   keys) — админ хочет «оживить» dead-строки одной кнопкой, не ожидая,
//   пока он сам сгенерит новый SQL-UPDATE.
//
// Что помещаем в retry:
//   status='pending', next_attempt_at=NOW(), attempt_count=0, last_error=NULL,
//   last_attempted_at=NULL.
//   Полученная строка НЕОТЛИЧИМА от свежей INSERT — worker возьмёт её в
//   lockBatch (WHERE status IN ('pending','failed')) на ближайшем tick'е.
//
// Безопасность:
//   1. WHERE status IN ('dead','failed') — НИКОГДА не «сбрасываем» pending/
//      in_flight/sent.  Retry на in_flight мог бы двойно отправить (worker
//      как раз её обрабатывает), retry на sent бессмысленен.
//   2. Либо `ids` (explicit set), либо `status` + `limit` — взаимоисключающие
//      режимы.  Retry «всех dead» без limit опасен (10k+ строк — pool stall).
//   3. Default limit=100, hard cap=1000.  Админ хочет больше — пусть делит на
//      страницы.
//
// Возврат: `{ revived: N, revivedIds: [] }`.  Строки, которые не попали под
// WHERE-clause (не-dead/не-failed, неверный id), просто не попадают в
// revivedIds — caller видит это по разнице с `ids.length`.

const DEFAULT_LIMIT = 100;
const HARD_LIMIT    = 1000;
const ALLOWED_FROM  = new Set(['dead', 'failed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {Object} ResurrectParams
 * @property {?string[]} ids    UUID-строки; force-retry точечно
 * @property {?string}   status 'dead' | 'failed'; bulk-retry (exclusive с ids)
 * @property {?number}   limit  max rows to touch (default 100, capped at 1000)
 */

/**
 * validateParams — чисто синхронная проверка, чтобы callers могли вернуть
 * 400 до похода в БД.  Throws TypeError('validation') с message-ом, по
 * которому можно безопасно формировать response body.
 */
function validateParams(params) {
  const p = params || {};
  const hasIds    = Array.isArray(p.ids) && p.ids.length > 0;
  const hasStatus = typeof p.status === 'string' && p.status.length > 0;

  if (!hasIds && !hasStatus) {
    throw new TypeError('resurrectOutboxRows: either `ids` (non-empty array) or `status` required');
  }
  if (hasIds && hasStatus) {
    throw new TypeError('resurrectOutboxRows: `ids` and `status` are mutually exclusive');
  }
  if (hasIds) {
    for (const id of p.ids) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('resurrectOutboxRows: every id must be a non-empty string');
      }
      if (!UUID_RE.test(id)) {
        throw new TypeError('resurrectOutboxRows: every id must be a valid UUID');
      }
    }
    if (p.ids.length > HARD_LIMIT) {
      throw new TypeError(`resurrectOutboxRows: ids length ${p.ids.length} exceeds hard cap ${HARD_LIMIT}`);
    }
  }
  if (hasStatus && !ALLOWED_FROM.has(p.status)) {
    throw new TypeError(`resurrectOutboxRows: status must be one of ${[...ALLOWED_FROM].join('|')}`);
  }
  if (p.limit != null) {
    if (!Number.isInteger(p.limit) || p.limit <= 0) {
      throw new TypeError('resurrectOutboxRows: limit must be a positive integer');
    }
    if (p.limit > HARD_LIMIT) {
      throw new TypeError(`resurrectOutboxRows: limit ${p.limit} exceeds hard cap ${HARD_LIMIT}`);
    }
  }
}

/**
 * resurrectOutboxRows — mutating helper.
 *
 * @param {{query: Function}} pool — pg Pool или Client.  Client удобнее, если
 *   вызов идёт внутри уже-открытой транзакции caller'а; но в текущем API
 *   retry-endpoint не в транзакции (один UPDATE, сам по себе атомарен).
 * @param {ResurrectParams} params
 * @returns {Promise<{revived: number, revivedIds: string[]}>}
 */
async function resurrectOutboxRows(pool, params) {
  validateParams(params);
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('resurrectOutboxRows: pool with .query required');
  }
  const p = params;

  // Решение: revivedIds берём из RETURNING id.  Это гарантирует, что
  // caller видит ТОЛЬКО те id, которые реально сменили статус.  Строка,
  // поданная в `ids`, но уже в статусе sent/pending/in_flight, просто
  // не попадёт в UPDATE — это желаемое поведение (idempotent).
  let sql;
  let args;
  if (Array.isArray(p.ids) && p.ids.length > 0) {
    // Точечный retry: status IN ('dead','failed') — защита от двойной
    // отправки на in_flight и от бессмысленного retry на sent.
    const propertyPredicate = p.propertyId ? 'AND property_id = $2' : '';
    sql = `
      UPDATE notifications_outbox
         SET status            = 'pending',
             next_attempt_at   = NOW(),
             attempt_count     = 0,
             last_error        = NULL,
             last_attempted_at = NULL
       WHERE id = ANY($1::uuid[])
         ${propertyPredicate}
         AND status IN ('dead','failed')
       RETURNING id
    `;
    args = p.propertyId ? [p.ids, p.propertyId] : [p.ids];
  } else {
    // Bulk retry с лимитом.  Использую подзапрос ORDER BY created_at
    // + LIMIT, чтобы «чинили» самые старые дохлые строки первыми (они
    // же самые «болезненные» для бизнес-процесса, user получил уведомление
    // позже всех).
    const limit = Math.min(p.limit || DEFAULT_LIMIT, HARD_LIMIT);
    const propertyPredicate = p.propertyId ? 'AND property_id = $3' : '';
    sql = `
      UPDATE notifications_outbox
         SET status            = 'pending',
             next_attempt_at   = NOW(),
             attempt_count     = 0,
             last_error        = NULL,
             last_attempted_at = NULL
       WHERE id IN (
         SELECT id FROM notifications_outbox
          WHERE status = $1
            ${propertyPredicate}
          ORDER BY created_at
          LIMIT $2
       )
       RETURNING id
    `;
    args = p.propertyId ? [p.status, limit, p.propertyId] : [p.status, limit];
  }

  const { rows } = await pool.query(sql, args);
  const revivedIds = rows.map((r) => r.id);
  return { revived: revivedIds.length, revivedIds };
}

module.exports = {
  resurrectOutboxRows,
  validateParams,
  DEFAULT_LIMIT,
  HARD_LIMIT,
  ALLOWED_FROM,
};
