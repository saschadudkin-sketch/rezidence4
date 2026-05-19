'use strict';

// platform-v1 notifications outbox worker — Spec: notifications-outbox-spec.md §4.4-§7.Q4.
//
// Этот модуль — «двигатель» outbox'а.  Он не знает про HTTP, не знает про
// каналы напрямую — он читает pending/failed строки, прогоняет их через
// `channels.dispatch`, переводит состояние и пишет факт доставки в
// `notification_log_v2`.
//
// Структура специально расколота на 4 уровня, каждый из которых легко
// тестируется изолированно:
//   1. processRow(tx, row, tenant)       — pure state-machine транзакция.
//      Assumes row уже locked (status='in_flight'), работает внутри tx.
//      Возвращает 'sent' | 'failed' | 'dead'.  НЕ бросает (адаптерные
//      throw'ы ловим и превращаем в retryable failure).
//   2. insertLogV2(tx, row, outcome)     — single INSERT в log_v2 с
//      нормализацией под constraints миграции 017 (vehicle → external,
//      external → recipient_id=NULL, attempt_count >= 1).
//   3. lockBatch(db, batchSize, propertyId) — atomic UPDATE...RETURNING,
//      переводит до N строк из {pending, failed, eligible} в in_flight.
//      Single SQL — атомарно относительно других воркеров даже без
//      advisory lock, но (acquire SKIP LOCKED не нужен: UPDATE с подзапросом
//      уже serialized per row).
//   4. processBatch(db, opts)            — iteration + per-row tx через
//      pool.connect(), catches catastrophes, revives stuck rows.
//   5. runOnce(db, opts)                 — advisory-lock wrapper per
//      propertyId, чтобы не запускать 2 воркера на один tenant.
//      Lock сессион-скоуп → держим один client на время всего tick'а.
//
// Deployment (setInterval, iteration по tenant'ам, health endpoint) —
// out-of-scope этого файла.  См. docs/platform-v1/deployment.md + PR+1.

const { performance } = require('perf_hooks');
const logger = require('../../logger');
const channels = require('../services/channels');
const { computeBackoffMinutes } = require('../services/notificationOutbox');
const appMetrics = require('../../metrics');

const DEFAULT_BATCH_SIZE = 50;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * truncate — режет строку под лимит колонки last_error / error_message
 * (обе TEXT, но ошибки бывают километровыми stack-trace'ами; храним только
 * первые N символов + маркер, чтобы не раздувать таблицу).
 */
function truncate(str, max = 500) {
  if (str == null) return null;
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

/**
 * deriveErrorCode — нормализует error в короткий код (varchar 40) для
 * log_v2.error_code.  Приоритет: явный `result.errorCode` → первый токен
 * error-сообщения до ':' → 'unknown_error'.  Constraint failed_coded
 * требует NOT NULL error_code, когда status='failed'.
 */
function deriveErrorCode(result) {
  if (!result) return 'unknown_error';
  if (result.errorCode) return truncate(result.errorCode, 40);
  const msg = result.error || result.message;
  if (!msg) return 'unknown_error';
  const head = String(msg).split(':')[0].trim();
  const cleaned = head.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
  return cleaned || 'unknown_error';
}

// ─── log_v2 INSERT ────────────────────────────────────────────────────────────

/**
 * insertLogV2 — единственная точка, где мы INSERT'им в `notification_log_v2`.
 * Constraints (миграция 017):
 *   - recipient_type ∈ {resident, staff, contractor, external}  (NO vehicle!)
 *   - external ⇒ recipient_id IS NULL
 *   - internal (остальные) ⇒ recipient_id IS NOT NULL
 *   - attempt_count >= 1
 *   - sent ⇒ error_code IS NULL AND error_message IS NULL
 *   - failed ⇒ error_code IS NOT NULL
 *   - UNIQUE partial on outbox_id
 *
 * Стратегия нормализации:
 *   - outbox.recipient_type='external' → NULL'им recipient_id (в outbox там
 *     может быть webhook.id, но log_v2 этого не принимает).
 *   - outbox.recipient_type='vehicle' → coerce → 'external' + NULL id.
 *     Диспетчер такие строки не производит, но защита дешёвая.
 *   - Если тип internal, но recipient_id пуст — coerce в external, иначе
 *     INSERT упадёт на internal_has_id.
 *
 * ON CONFLICT DO NOTHING страхует от двойного INSERT'а, если worker по
 * какой-то причине обработает ту же outbox-строку дважды (advisory lock +
 * status-machine это исключают, но defense-in-depth дешёвое).
 */
async function insertLogV2(tx, row, outcome) {
  const {
    status, attemptCount, errorCode, errorMessage, providerMessageId,
  } = outcome;

  let logType = row.recipient_type;
  let logRecipientId = row.recipient_id;

  if (logType === 'external') {
    logRecipientId = null;
  } else if (logType === 'vehicle') {
    logType = 'external';
    logRecipientId = null;
  } else if (!logRecipientId) {
    // internal без recipient_id — не лезет в log_v2 как internal.
    logType = 'external';
    logRecipientId = null;
  }

  const payload = (typeof row.payload === 'string')
    ? row.payload
    : JSON.stringify(row.payload || {});

  await tx.query(
    `INSERT INTO notification_log_v2
       (property_id, outbox_id, recipient_type, recipient_id, recipient_address,
        channel, event_type, status, payload, error_code, error_message,
        provider_message_id, attempt_count, sent_at)
     VALUES ($1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11,
             $12, $13, NOW())
     ON CONFLICT DO NOTHING`,
    [
      row.property_id,
      row.id,
      logType,
      logRecipientId,
      row.recipient_address,
      row.channel,
      row.event_type,
      status,
      payload,
      status === 'failed' ? (errorCode || 'unknown_error') : null,
      status === 'failed' ? (errorMessage || null) : null,
      providerMessageId || null,
      Math.max(1, attemptCount | 0),
    ],
  );
}

// ─── state-machine ────────────────────────────────────────────────────────────

/**
 * processRow — основная state-machine.
 *
 * Предусловие:
 *   - row уже имеет status='in_flight' (lockBatch перевёл).
 *   - tx — pg client в открытой транзакции.  НЕ pool.
 *
 * Постусловие (commit caller'а):
 *   - 'sent':  outbox.status='sent', sent_at=NOW(); log_v2 row status='sent'.
 *   - 'dead':  outbox.status='dead'; log_v2 row status='failed' (log_v2 не
 *             знает 'dead' — последний fail ложится как failed + error_code).
 *   - 'failed': outbox.status='failed', next_attempt_at+=backoff; log_v2
 *             НЕ пишем (только финальная попытка логируется).
 *
 * Dead criteria (любой из):
 *   (a) adapter вернул {dead:true}  (permanent error: unknown_channel,
 *       410 Gone, invalid_phone_number, webhook inactive, etc.)
 *   (b) attempt_count + 1 >= max_attempts (exhausted retries)
 *   (c) computeBackoffMinutes(next attempt) === null  (overrun лестницы)
 *
 * Adapter throw обрабатываем как `{ok:false, dead:false}` — сеть пошевелится,
 * на следующем tick'е попробуем снова.
 */
async function processRow(tx, row, tenant = null) {
  let result;
  // Wall-clock от старта channels.dispatch до его резолва/throw — именно
  // это ловит на Grafana-панели p95 «сколько живёт один send».  Не Date.now:
  // monotonic performance.now() не скачет назад при NTP-sync.
  const t0 = performance.now();
  try {
    result = await channels.dispatch(row.channel, {
      recipientAddress: row.recipient_address,
      recipientType:    row.recipient_type,
      recipientId:      row.recipient_id,
      payload:          row.payload,
      eventType:        row.event_type,
      correlationId:    row.correlation_id,
      tenant,
      row,
    });
  } catch (err) {
    // Защита от bad adapter — любая необработанная ошибка = retryable failure.
    logger.error(
      { err: err.message, channel: row.channel, outboxId: row.id },
      '[outbox-worker] adapter threw',
    );
    result = { ok: false, dead: false, error: err.message || 'adapter_threw' };
  }
  const durationMs = performance.now() - t0;

  const newAttemptCount = (row.attempt_count | 0) + 1;

  // ── success path ─────────────────────────────────────────────────
  if (result && result.ok) {
    await tx.query(
      `UPDATE notifications_outbox
         SET status='sent',
             sent_at=NOW(),
             last_attempted_at=NOW(),
             attempt_count=$2,
             last_error=NULL
       WHERE id=$1
         AND property_id=$3`,
      [row.id, newAttemptCount, row.property_id],
    );
    await insertLogV2(tx, row, {
      status: 'sent',
      attemptCount: newAttemptCount,
      errorCode: null,
      errorMessage: null,
      providerMessageId: result.providerMessageId || null,
    });
    appMetrics.recordOutboxDelivery(row.channel, 'sent', durationMs);
    return 'sent';
  }

  // ── failure / dead path ─────────────────────────────────────────
  const reachedMax = newAttemptCount >= (row.max_attempts | 0);
  const backoffMin = computeBackoffMinutes(newAttemptCount); // null → overrun
  const overrun    = backoffMin === null;
  const isDead     = Boolean(result?.dead) || reachedMax || overrun;

  const errorCode    = deriveErrorCode(result);
  const errorMessage = truncate(result?.error || 'unknown_error', 500);

  if (isDead) {
    await tx.query(
      `UPDATE notifications_outbox
         SET status='dead',
             last_attempted_at=NOW(),
             attempt_count=$2,
             last_error=$3
       WHERE id=$1
         AND property_id=$4`,
      [row.id, newAttemptCount, errorMessage, row.property_id],
    );
    await insertLogV2(tx, row, {
      status: 'failed',      // log_v2 не имеет 'dead' — последний fail пишем
      attemptCount: newAttemptCount,
      errorCode,
      errorMessage,
      providerMessageId: null,
    });
    appMetrics.recordOutboxDelivery(row.channel, 'dead', durationMs);
    return 'dead';
  }

  // retryable → schedule next attempt
  await tx.query(
    `UPDATE notifications_outbox
       SET status='failed',
           last_attempted_at=NOW(),
           next_attempt_at=NOW() + ($2 * INTERVAL '1 minute'),
           attempt_count=$3,
           last_error=$4
     WHERE id=$1
       AND property_id=$5`,
    [row.id, backoffMin, newAttemptCount, errorMessage, row.property_id],
  );
  appMetrics.recordOutboxDelivery(row.channel, 'failed', durationMs);
  return 'failed';
}

// ─── batch locking ────────────────────────────────────────────────────────────

/**
 * lockBatch — атомарно забирает до `batchSize` eligible строк и помечает
 * их `in_flight`.  Возвращает массив строк (с полями, нужными для processRow).
 *
 * Почему CTE + FOR UPDATE SKIP LOCKED?
 * Одна SQL команда выполняет выбор и мутацию атомарно, но кандидатные строки
 * дополнительно блокируются на уровне Postgres.  Параллельные воркеры на той
 * же property уже отсечены advisory-lock'ом в runOnce(); это второй эшелон
 * защиты на случай race'а или вызова processBatch без advisory-lock wrapper.
 *
 * ORDER BY next_attempt_at — FIFO-ish: старые pending уходят первыми.
 */
async function lockBatch(db, batchSize = DEFAULT_BATCH_SIZE, propertyId = null) {
  const params = [batchSize];
  const propertyFilter = propertyId ? `AND property_id::text = $${params.length + 1}` : '';
  if (propertyId) params.push(String(propertyId));

  const { rows } = await db.query(
    `WITH candidates AS (
       SELECT id
         FROM notifications_outbox
        WHERE status IN ('pending','failed')
          AND next_attempt_at <= NOW()
          ${propertyFilter}
        ORDER BY next_attempt_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE notifications_outbox
       SET status='in_flight',
           last_attempted_at=NOW()
      FROM candidates
     WHERE notifications_outbox.id = candidates.id
       AND notifications_outbox.status IN ('pending','failed')
       ${propertyId ? `AND notifications_outbox.property_id::text = $${params.length}` : ''}
     RETURNING notifications_outbox.id, property_id, event_type, channel, recipient_type,
               recipient_id, recipient_address, payload,
               attempt_count, max_attempts, correlation_id`,
    params,
  );
  return rows;
}

// ─── per-row iteration ────────────────────────────────────────────────────────

/**
 * processBatch — забирает batch и прогоняет строки по одной, каждая в
 * своей короткой транзакции (state update + log_v2 INSERT атомарны).
 *
 * Catastrophic fallback:
 *   Если per-row tx падает на непредвиденном error'е (пример: БД упала
 *   mid-insert), ROLLBACK'им, затем вне tx переводим строку в 'failed' +
 *   небольшой backoff, чтобы она не зависла в `in_flight` навсегда.
 *   Это MVP-замена для reaper-таска (поэтапный cleanup для stuck rows).
 */
async function processBatch(db, opts = {}) {
  const { batchSize = DEFAULT_BATCH_SIZE, tenant = null, propertyId = null } = opts;
  const rows = await lockBatch(db, batchSize, propertyId);
  const counts = { sent: 0, failed: 0, dead: 0, errors: 0 };

  for (const row of rows) {
    let client;
    try {
      client = await db.connect();
    } catch (err) {
      // Pool exhausted / connection refused — выйти из батча, пусть tick
      // завершится.  Строки останутся в in_flight; следующий tick + revival
      // ниже (через tick-end cleanup) их поднимет.  На проде это
      // сигнализирует об истинной проблеме — алёртим.
      counts.errors += 1;
      logger.error(
        { err: err.message, outboxId: row.id },
        '[outbox-worker] cannot acquire client — bailing batch',
      );
      break;
    }

    try {
      await client.query('BEGIN');
      const outcome = await processRow(client, row, tenant);
      await client.query('COMMIT');
      counts[outcome] = (counts[outcome] || 0) + 1;
    } catch (err) {
      counts.errors += 1;
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      logger.error(
        { err: err.message, outboxId: row.id },
        '[outbox-worker] row tx failed, reviving',
      );
      // Revival: вывалим строку обратно в failed + 5-мин backoff, чтобы
      // не залегла в in_flight.  (Reaper-таск в будущем отберёт стрые
      // in_flight по last_attempted_at < NOW() - 1h.)
      try {
        await db.query(
          `UPDATE notifications_outbox
             SET status='failed',
                 next_attempt_at=NOW() + INTERVAL '5 minutes',
                 last_error=$2
           WHERE id=$1
             AND property_id=$3`,
          [row.id, truncate(err.message || 'worker_tx_failed', 500), row.property_id],
        );
      } catch (revErr) {
        logger.error(
          { err: revErr.message, outboxId: row.id },
          '[outbox-worker] revival UPDATE failed — row will be picked up by reaper',
        );
      }
    } finally {
      try { client.release(); } catch (_) { /* ignore */ }
    }
  }

  return { processed: rows.length, ...counts };
}

// ─── advisory-lock wrapper ────────────────────────────────────────────────────

/**
 * runOnce — один «tick» для конкретного property.  Берёт session-scoped
 * advisory lock `hashtext('outbox-'+propertyId)`: параллельные воркеры
 * (multi-instance API) не обработают одну и ту же property дважды.
 *
 * pg_try_advisory_lock non-blocking — если лок уже взят, возвращаем
 * {acquired:false, processed:0}, следующий tick попробует снова.
 *
 * Важно: advisory lock привязан к СЕССИИ (backend connection).  Поэтому
 * мы держим один `client` на всё время tick'а и через него же
 * unlock'аем.  `processBatch` спавнит свои per-row client'ы из пула —
 * это ОК, advisory lock у них другой (session = другой backend).
 */
async function runOnce(db, opts = {}) {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    propertyId,
    rowPropertyId = propertyId,
    tenant = null,
  } = opts;
  if (!propertyId) {
    throw new Error('outboxWorker.runOnce: propertyId required for advisory lock');
  }

  const lockKey = `outbox-${propertyId}`;
  const client = await db.connect();
  try {
    const { rows: lockRows } = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [lockKey],
    );
    const acquired = Boolean(lockRows[0]?.locked);
    if (!acquired) {
      return { acquired: false, processed: 0 };
    }

    try {
      const stats = await processBatch(db, { batchSize, tenant, propertyId: rowPropertyId });
      return { acquired: true, ...stats };
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
      } catch (err) {
        // Unlock failed — сессия всё равно закроется (client.release) и
        // лок будет снят pg-сервером.  Логируем как warning.
        logger.warn(
          { err: err.message, propertyId },
          '[outbox-worker] advisory_unlock failed (lock will expire on session close)',
        );
      }
    }
  } finally {
    try { client.release(); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  runOnce,
  processBatch,
  processRow,
  lockBatch,
  insertLogV2,
  // helpers exposed for tests:
  truncate,
  deriveErrorCode,
  DEFAULT_BATCH_SIZE,
};
