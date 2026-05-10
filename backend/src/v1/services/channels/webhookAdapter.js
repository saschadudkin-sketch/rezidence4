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
const { validateOutboundUrl } = require('../../../lib/urlSafety');

const REQUEST_TIMEOUT_MS = 10_000;
const WEBHOOK_PAYLOAD_VERSION = 'v1';

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

function resolveDeliveryId({ row, correlationId }) {
  return row?.id || correlationId || null;
}

function buildWebhookEnvelope({
  payload,
  correlationId,
  row,
  now = new Date(),
}) {
  const event = payload?.event || row?.event_type || 'unknown';
  const deliveryId = resolveDeliveryId({ row, correlationId });
  const attempt = Number.isInteger(row?.attempt_count) ? row.attempt_count + 1 : null;

  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    event,
    eventId: deliveryId,
    deliveryId,
    correlationId: correlationId || null,
    attempt,
    timestamp: now.toISOString(),
    data: payload?.data ?? payload ?? {},
  };
}

/**
 * send — POST webhook payload с HMAC.
 *
 * @param {object} args
 * @param {string} args.recipientAddress URL (webhooks.url snapshot)
 * @param {?string} args.recipientId     webhooks.id (UUID)
 * @param {?string} args.correlationId   outbox.correlation_id (business entity trace)
 * @param {object} args.payload          { event, data, ... }
 * @param {?object} args.row             notifications_outbox row (id is the stable delivery id)
 * @param {object} args.tenant           { db }
 */
async function send({
  recipientAddress,
  recipientId,
  correlationId,
  payload,
  row,
  tenant,
}) {
  if (!recipientAddress) {
    return { ok: false, error: 'url_required' };
  }

  // SEC [AUDIT-SSRF]: defense-in-depth.  routes/webhooks.js уже отвергает
  // private/metadata URL'ы при INSERT, но snapshot мог попасть в outbox до
  // включения guard'а или через миграцию/прямой SQL.  Проверяем ещё раз
  // перед fetch'ем — SSRF-payload не должен дойти до сети.
  const urlCheck = validateOutboundUrl(recipientAddress, { allowedProtocols: ['https:'] });
  if (!urlCheck.ok) {
    logger.warn(
      { webhookId: recipientId, reason: urlCheck.reason },
      '[outbox:webhook] SSRF guard rejected URL — marking dead',
    );
    return { ok: false, error: `ssrf_blocked:${urlCheck.reason}`, dead: true };
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

  // Совместимость с legacy контрактом: внешние подписчики привыкли к
  // event/timestamp/deliveryId/data.  DH-40 добавляет version/eventId/
  // correlationId/attempt без удаления старых полей.  deliveryId/eventId =
  // notifications_outbox.id, поэтому retry одной и той же строки имеет
  // стабильный idempotency key у внешнего получателя.
  const envelope = buildWebhookEnvelope({ payload, correlationId, row });
  const deliveryId = envelope.deliveryId || '';
  const wireBody = JSON.stringify(envelope);
  const sig = signPayload(wireBody, secret);

  try {
    const res = await fetch(recipientAddress, {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-DomHub-Signature': `sha256=${sig}`,
        'X-DomHub-Event':     envelope.event,
        'X-DomHub-Event-Version': WEBHOOK_PAYLOAD_VERSION,
        'X-DomHub-Event-Id':  deliveryId,
        'X-DomHub-Delivery':  deliveryId,
        'X-DomHub-Correlation-Id': envelope.correlationId || '',
        'X-DomHub-Attempt': envelope.attempt == null ? '' : String(envelope.attempt),
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

module.exports = {
  send,
  signPayload,
  loadWebhookSecret,
  buildWebhookEnvelope,
  resolveDeliveryId,
  WEBHOOK_PAYLOAD_VERSION,
};
