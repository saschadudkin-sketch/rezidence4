'use strict';

// platform-v1 notification dispatcher — Spec: notifications-outbox-spec.md §5.
//
// Единая точка входа для уведомлений в Phase 5 и далее.  Выбирает один из
// двух путей:
//   - outbox mode:  isOutboxEnabled() && caller передал tx (pg client) +
//                   property — формируем outbox-строки per-recipient ×
//                   per-channel и batch-INSERT через enqueueNotificationBatch.
//                   Worker потом отправит их асинхронно.
//   - inline mode:  всё остальное → делегация в legacy
//                   notificationService.dispatch (старый inline-send).
//                   Это дефолт (flag OFF) + fall-back при отсутствии tx.
//
// Зачем tx обязателен для outbox-режима:
//   spec §4.1 — outbox бесполезен без atomicity с бизнес-мутацией.  Вызов
//   без tx превратится в dual-write (business COMMIT → outbox INSERT →
//   crash между ними = уведомление теряется).  Лучше fallback в legacy,
//   чем иллюзия надёжности.
//
// Webhook-канал:
//   - в outbox-mode: одна строка outbox per active webhook (recipient_type
//     = 'external', recipient_id = webhooks.id).
//   - в inline-mode: legacy webhookService.enqueueWebhookEvent
//     (webhook_deliveries table).  Ничего не меняем.
//
// Callers, которые хотят outbox-семантику:
//   const result = await dispatchEvent({ event, data, db, tx, property });
// Callers без tx получают legacy inline behaviour автоматически.

const logger = require('../../logger');
const notificationService = require('../../services/notificationService');
const {
  enqueueNotificationBatch,
  isOutboxEnabled,
} = require('./notificationOutbox');

const {
  buildMessages,
  EVENT_CHANNELS,
  getBroadcastRoles,
  getUserSubscriptions,
  getUserById,
  getPropertyUsers,
} = notificationService;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value) {
  const text = String(value || '');
  return UUID_RE.test(text) ? text : null;
}

// ─── recipient resolution ─────────────────────────────────────────────────────

/**
 * resolveUserIds — определяет список пользователей-получателей.  Использует
 * ту же логику, что и legacy `dispatch`: explicit userIds > explicit userId
 * > broadcast by role.
 */
async function resolveUserIds(event, data, db) {
  if (Array.isArray(data?.userIds) && data.userIds.length > 0) {
    return data.userIds;
  }
  if (data?.userId) return [data.userId];
  const roles = (typeof getBroadcastRoles === 'function')
    ? (getBroadcastRoles(event) || [])
    : [];
  if (roles.length === 0) return [];
  const users = await getPropertyUsers(roles, db);
  return users.map((u) => u.uid);
}

/**
 * getActiveWebhooksForEvent — список webhook'ов, подписанных на данный event.
 * Возвращает {id, url} — достаточно для outbox row (secret грузим в
 * webhookAdapter из webhooks table по recipient_id в момент отправки).
 */
async function getActiveWebhooksForEvent(event, db) {
  const { rows } = await db.query(
    `SELECT id, url FROM webhooks WHERE is_active = true AND $1 = ANY(events)`,
    [event],
  );
  return rows;
}

// ─── outbox row builders ──────────────────────────────────────────────────────

/**
 * buildRowsForUser — для одного userId собирает outbox rows по каналам,
 * которые соответствуют маршрутизации event'а.  Требует db (pool) для
 * чтения push_subscriptions + users.phone.
 */
async function buildRowsForUser({ userId, event, data, channels, messages, db }) {
  const rows = [];
  const subs = await getUserSubscriptions(userId, db);
  const webSubs = subs.filter((s) => s.platform === 'web');
  const tgSubs  = subs.filter((s) => s.platform === 'telegram' && s.telegram_chat_id);

  if (channels.push && messages.push && webSubs.length > 0) {
    for (const sub of webSubs) {
      rows.push({
        eventType: event,
        channel: 'web_push',
        recipientType: 'resident',
        recipientId: uuidOrNull(userId),
        recipientAddress: JSON.stringify({
          user_id: userId,
          subscription_id: sub.id,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        }),
        payload: messages.push,
      });
    }
  }

  if (channels.telegram && messages.telegram && tgSubs.length > 0) {
    for (const sub of tgSubs) {
      rows.push({
        eventType: event,
        channel: 'telegram',
        recipientType: 'resident',
        recipientId: uuidOrNull(userId),
        recipientAddress: sub.telegram_chat_id,
        payload: { text: messages.telegram },
      });
    }
  }

  if (channels.sms && messages.sms) {
    const user = await getUserById(userId, db);
    if (user?.phone) {
      rows.push({
        eventType: event,
        channel: 'sms',
        recipientType: 'resident',
        recipientId: uuidOrNull(userId),
        recipientAddress: user.phone,
        payload: { message: messages.sms },
      });
    }
  }

  return rows;
}

// ─── outbox dispatch ──────────────────────────────────────────────────────────

/**
 * dispatchViaOutbox — outbox-path полностью.  НЕ swallow'ит ошибки —
 * пусть ломают caller'скую транзакцию (см. spec §4.1).
 *
 * @param {object} args
 * @param {string} args.event
 * @param {object} args.data
 * @param {object} args.property  {id, ...} — property context
 * @param {object} args.db        pg pool (для READ-only запросов: subs, users, webhooks)
 * @param {object} args.tx        pg client в BEGIN — сюда идёт INSERT outbox
 */
async function dispatchViaOutbox({ event, data, property, db, tx }) {
  if (!property?.id) throw new Error('dispatchViaOutbox: property.id required');
  if (!tx || typeof tx.query !== 'function') {
    throw new Error('dispatchViaOutbox: tx (pg client) required');
  }

  const channels = EVENT_CHANNELS[event] || { push: true, sms: false, telegram: false };
  const messages = (typeof buildMessages === 'function')
    ? buildMessages(event, data || {})
    : null;
  if (!messages) {
    logger.warn({ event }, '[dispatcher] buildMessages unavailable — nothing to enqueue');
    return { mode: 'outbox', enqueued: 0 };
  }

  const userIds = await resolveUserIds(event, data || {}, db);

  const rows = [];
  for (const userId of userIds) {
    const userRows = await buildRowsForUser({
      userId, event, data, channels, messages, db,
    });
    for (const r of userRows) {
      rows.push({
        ...r,
        propertyId:    property.id,
        correlationId: data?.correlationId || null,
      });
    }
  }

  // Webhooks fan-out (external recipient_type).
  const webhooks = await getActiveWebhooksForEvent(event, db);
  for (const wh of webhooks) {
    rows.push({
      propertyId:       property.id,
      eventType:        event,
      channel:          'webhook',
      recipientType:    'external',
      recipientId:      wh.id,
      recipientAddress: wh.url,
      payload:          { event, data: data || {} },
      correlationId:    data?.correlationId || null,
    });
  }

  if (rows.length === 0) {
    return { mode: 'outbox', enqueued: 0 };
  }

  await enqueueNotificationBatch(tx, rows);
  return { mode: 'outbox', enqueued: rows.length };
}

// ─── public entry ─────────────────────────────────────────────────────────────

/**
 * dispatchEvent — Phase-5 public entry point.
 *
 * Routing:
 *   isOutboxEnabled() + tx + property  →  outbox mode  (throws on failure)
 *   otherwise                          →  legacy inline mode (swallows errors)
 *
 * @param {object} args
 * @param {string} args.event
 * @param {object} args.data
 * @param {object} args.db        pg pool (req.db)
 * @param {?object} args.tx       pg client (optional; enables outbox mode)
 * @param {?object} args.property property context ({id, telegram_bot_token, ...})
 * @returns {Promise<{mode: 'outbox'|'inline', enqueued?: number, error?: string}>}
 */
async function dispatchEvent({ event, data, db, tx, property }) {
  const wantOutbox = isOutboxEnabled() && tx && property?.id;

  if (wantOutbox) {
    // Outbox errors propagate — caller's transaction should rollback so that
    // bizness mutation и outbox не расходятся.  (Spec §4.1.)
    return dispatchViaOutbox({ event, data, property, db, tx });
  }

  // Legacy inline path — swallows its own errors (top-level try-catch
  // внутри dispatch).  Мы дополнительно ловим rejection промиса из-за
  // неожиданных ошибок в promise chain'е самого dispatch'а.
  try {
    await notificationService.dispatch(event, data || {}, db, property);
    return { mode: 'inline' };
  } catch (err) {
    // dispatch уже сам глотает, но на всякий случай — notifications не
    // должны ломать бизнес-поток в inline-режиме.
    logger.error(
      { err: err.message, event },
      '[dispatcher] inline dispatch threw unexpectedly (swallowed)',
    );
    return { mode: 'inline', error: err.message };
  }
}

module.exports = {
  dispatchEvent,
  // exposed for tests:
  dispatchViaOutbox,
  resolveUserIds,
  getActiveWebhooksForEvent,
  buildRowsForUser,
};
