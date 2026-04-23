'use strict';

// platform-v1 webhook channel adapter — Spec: notifications-outbox-spec.md §4.4, §7 Q5.
//
// Перенос `webhookService.deliverOne` из legacy, упрощён:
//   - нет отдельной таблицы webhook_deliveries (outbox = единый tracker);
//   - нет RETRY_DELAYS константы (backoff живёт в outbox state-machine);
//   - HMAC-подпись payload'а — здесь, как и раньше.
//
// Producer при enqueue использует:
//   channel          = 'webhook'
//   recipientType    = 'external'
//   recipientId      = <webhooks.id>   (UUID, для lookup secret+url)
//   recipientAddress = <webhooks.url>  (денормализованный снимок)
//   payload.event    = 'request.approved' (добавляется producer'ом)
//   payload.data     = {...} (бизнес-payload)
//
// URL берём из `recipientAddress` (не идём в БД лишний раз), а секрет
// читаем из `webhooks.id = recipientId` на send'е — у секрета короткий
// жизненный цикл и админ может ротировать его между попытками.

const crypto = require('crypto');
const logger = require('../../../logger');

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Загрузить webhook secret из БД (свежий, чтобы уважать ротацию).
 * @returns {Promise<?string>}
 */
async function loadWebhookSecret(recipientId, db) {
  if (!recipientId || !db) return null;
  try {
    const { rows } = await db.query(
      `SELECT secret FROM webhooks WHERE id = $1 AND is_active = true`,
      [recipientId],
    );
    return rows[0]?.secret || null;
  } catch (err) {
    logger.warn(
      { err: err.message, webhookId: recipientId },
      '[outbox:webhook] failed to load secret',
    );
    return null;
  }
}

function signPayload(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * send — POST webhook payload с HMAC.
 *
 * @param {object} args
 * @param {string} args.recipientAddress URL (webhooks.url snapshot)
 * @param {?string} args.recipientId     webhooks.id (UUID)
 * @param {?string} args.correlationId   outbox.correlation_id (delivery-id header)
 * @param {object} args.payload          { event, data, ... }
 * @param {object} args.tenant           { db }
 */
async function send({ recipientAddress, recipientId, correlationId, payload, tenant }) {
  if (!recipientAddress) {
    return { ok: false, error: 'url_required' };
  }

  // Webhook, который был отключён между enqueue и send — cancel, помечаем dead.
  const secret = await loadWebhookSecret(recipientId, tenant?.db);
  if (!secret) {
    return {
      ok: false,
      error: 'webhook_inactive_or_missing_secret',
      dead: true,
    };
  }

  // Совместимость с legacy контрактом: внешние подписчики привыкли к этой
  // обёртке (event/timestamp/deliveryId/data).
  const wireBody = JSON.stringify({
    event:      payload?.event || 'unknown',
    timestamp:  new Date().toISOString(),
    deliveryId: correlationId || null,
    data:       payload?.data ?? payload ?? {},
  });
  const sig = signPayload(wireBody, secret);

  try {
    const res = await fetch(recipientAddress, {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-DomHub-Signature': `sha256=${sig}`,
        'X-DomHub-Event':     payload?.event || 'unknown',
        'X-DomHub-Delivery':  correlationId || '',
      },
      body: wireBody,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) {
      // Обновляем last_success_at, обнуляем retry_count в webhooks — это
      // для admin-UI «когда последний раз сработал этот webhook».
      if (tenant?.db && recipientId) {
        tenant.db.query(
          `UPDATE webhooks
              SET last_success_at = NOW(),
                  last_attempt_at = NOW(),
                  retry_count = 0
            WHERE id = $1`,
          [recipientId],
        ).catch((err) => logger.warn(
          { err: err.message, webhookId: recipientId },
          '[outbox:webhook] failed to update success metrics',
        ));
      }
      return { ok: true };
    }

    const errorBody = (await res.text()).slice(0, 500);
    const errorMsg = `HTTP_${res.status}: ${errorBody}`;
    if (tenant?.db && recipientId) {
      tenant.db.query(
        `UPDATE webhooks
            SET last_attempt_at = NOW(),
                last_error = $1
          WHERE id = $2`,
        [errorMsg, recipientId],
      ).catch(() => { /* non-fatal */ });
    }
    return { ok: false, error: errorMsg };
  } catch (err) {
    if (tenant?.db && recipientId) {
      tenant.db.query(
        `UPDATE webhooks
            SET last_attempt_at = NOW(),
                last_error = $1
          WHERE id = $2`,
        [err.message || 'request_failed', recipientId],
      ).catch(() => { /* non-fatal */ });
    }
    return { ok: false, error: err.message || 'webhook_request_failed' };
  }
}

module.exports = { send, signPayload, loadWebhookSecret };
