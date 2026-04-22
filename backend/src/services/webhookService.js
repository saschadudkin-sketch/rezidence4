'use strict';

const crypto = require('crypto');
const logger = require('../logger');

// Retry back-off delays in seconds: 1m, 5m, 30m
const RETRY_DELAYS_SECONDS = [60, 300, 1800];

/**
 * enqueueWebhookEvent — create a webhook_deliveries row for every active
 * webhook that subscribes to `event`.
 *
 * @param {string} event   — event name, e.g. 'request.approved'
 * @param {object} data    — event payload (will be stored as JSONB)
 * @param {object} db      — pg pool for this property (req.db)
 */
async function enqueueWebhookEvent(event, data, db) {
  const { rows: webhooks } = await db.query(
    `SELECT id FROM webhooks WHERE is_active = true AND $1 = ANY(events)`,
    [event],
  );

  if (webhooks.length === 0) return;

  for (const webhook of webhooks) {
    await db.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, next_attempt_at)
       VALUES ($1, $2, $3, NOW())`,
      [webhook.id, event, JSON.stringify(data)],
    );
  }

  logger.debug({ event, webhookCount: webhooks.length }, '[webhook] enqueued deliveries');
}

/**
 * processPendingDeliveries — attempt delivery for every pending/retrying row
 * whose next_attempt_at has passed. Processes up to 20 rows per call.
 * Intended to be called by the background job every 30 s.
 *
 * @param {object} db — pg pool for this property
 */
async function processPendingDeliveries(db) {
  const { rows } = await db.query(`
    SELECT d.*, w.url, w.secret, w.name
    FROM webhook_deliveries d
    JOIN webhooks w ON w.id = d.webhook_id
    WHERE d.status IN ('pending', 'retrying')
      AND d.next_attempt_at <= NOW()
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  `);

  for (const delivery of rows) {
    await deliverOne(delivery, db);
  }
}

/**
 * deliverOne — HTTP-POST a single delivery, update its status, and update the
 * parent webhook's aggregate fields.
 *
 * @param {object} delivery — row from webhook_deliveries JOIN webhooks
 * @param {object} db
 */
async function deliverOne(delivery, db) {
  const payload = {
    event:      delivery.event_type,
    timestamp:  new Date().toISOString(),
    deliveryId: delivery.id,
    data:       delivery.payload,
  };
  const body = JSON.stringify(payload);
  const sig  = crypto
    .createHmac('sha256', delivery.secret)
    .update(body)
    .digest('hex');

  let responseStatus, responseBody, error;

  try {
    const res = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'X-DomHub-Signature':  `sha256=${sig}`,
        'X-DomHub-Event':      delivery.event_type,
        'X-DomHub-Delivery':   delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    responseStatus = res.status;
    responseBody   = (await res.text()).slice(0, 500);

    if (res.ok) {
      await db.query(
        `UPDATE webhook_deliveries
         SET status = 'success', response_status = $1, response_body = $2,
             attempt_count = attempt_count + 1, completed_at = NOW()
         WHERE id = $3`,
        [responseStatus, responseBody, delivery.id],
      );
      await db.query(
        `UPDATE webhooks
         SET last_success_at = NOW(), retry_count = 0, last_attempt_at = NOW()
         WHERE id = $1`,
        [delivery.webhook_id],
      );
      logger.debug({ deliveryId: delivery.id, url: delivery.url }, '[webhook] delivered successfully');
      return;
    }
  } catch (err) {
    error = err.message;
    logger.warn({ err: error, deliveryId: delivery.id, url: delivery.url }, '[webhook] delivery attempt failed');
  }

  // Delivery failed — decide whether to retry or mark as permanently failed.
  // attempt_count is the number of *completed* attempts so far (pre-increment);
  // use it to index into RETRY_DELAYS_SECONDS.
  const nextDelaySeconds = delivery.attempt_count < RETRY_DELAYS_SECONDS.length
    ? RETRY_DELAYS_SECONDS[delivery.attempt_count]
    : null;

  if (nextDelaySeconds !== null) {
    await db.query(
      `UPDATE webhook_deliveries
       SET status = 'retrying',
           attempt_count = attempt_count + 1,
           next_attempt_at = NOW() + ($1 || ' seconds')::INTERVAL,
           response_status = $2,
           error_message = $3
       WHERE id = $4`,
      [String(nextDelaySeconds), responseStatus ?? null, error ?? null, delivery.id],
    );
    await db.query(
      `UPDATE webhooks
       SET last_attempt_at = NOW()
       WHERE id = $1`,
      [delivery.webhook_id],
    );
  } else {
    await db.query(
      `UPDATE webhook_deliveries
       SET status = 'failed',
           attempt_count = attempt_count + 1,
           completed_at = NOW(),
           response_status = $1,
           error_message = $2
       WHERE id = $3`,
      [responseStatus ?? null, error ?? null, delivery.id],
    );
    await db.query(
      `UPDATE webhooks
       SET last_error = $1, last_attempt_at = NOW(), retry_count = retry_count + 1
       WHERE id = $2`,
      [error ?? `HTTP ${responseStatus}`, delivery.webhook_id],
    );
    logger.warn({ deliveryId: delivery.id, url: delivery.url }, '[webhook] delivery permanently failed');
  }
}

module.exports = { enqueueWebhookEvent, processPendingDeliveries };
