'use strict';

/**
 * services/notificationService.js — central notification dispatcher (Phase 1).
 *
 * All notification sending goes through dispatch(event, data, db).
 * Notification failures are ALWAYS swallowed — they must never break main business logic.
 *
 * Channel routing per event:
 *   guest.arrived          → push (web) + sms
 *   request.approved       → push (web) + telegram
 *   request.rejected       → push (web) + telegram
 *   announcement.published → push (web) to all residents
 *   blacklist.attempt      → push (web) + sms + telegram to security+admin
 *   package.arrived        → push + sms to recipient
 *   booking.confirmed      → push to booking creator
 *   meter.reminder         → push to all active residents
 *   billing.overdue        → push + sms to resident
 *
 * Install web-push if VAPID vars are configured:
 *   npm install web-push
 */

const logger = require('../logger');
const { sendSms } = require('./smsService');
const webhookService = require('./webhookService');

// ─── VAPID / web-push setup ───────────────────────────────────────────────────

let webpush = null;

function getWebPush() {
  if (webpush !== null) return webpush; // already resolved (could be false)
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.warn('[notify] VAPID env vars not set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) — web push disabled');
    webpush = false;
    return false;
  }
  try {
    const wp = require('web-push');
    wp.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    webpush = wp;
    logger.info('[notify] web-push initialised with VAPID keys');
    return wp;
  } catch (err) {
    logger.warn({ err: err.message }, '[notify] web-push not installed — run: npm install web-push');
    webpush = false;
    return false;
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

/**
 * sendTelegramMessage — static helper, no bot state required.
 * Exported so telegramBot.js can reuse it.
 */
async function sendTelegramMessage(chatId, text, botToken) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

// ─── Channel helpers ──────────────────────────────────────────────────────────

/**
 * sendWebPush — send a notification to a single push_subscriptions row.
 * Handles dead endpoints (410/404) by deactivating the subscription.
 * Increments failure_count and deactivates after >= 5 failures.
 * @param {object} subscription — row from push_subscriptions
 * @param {object} payload      — { title, body, url? }
 * @param {object} db           — pg pool for this property
 */
async function sendWebPush(subscription, payload, db) {
  const wp = getWebPush();
  if (!wp) return;

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await wp.sendNotification(pushSubscription, JSON.stringify(payload));
    // Update last_sent_at on success
    await db.query(
      `UPDATE push_subscriptions SET last_sent_at = NOW(), failure_count = 0 WHERE id = $1`,
      [subscription.id],
    ).catch((err) => logger.warn({ err }, '[notify:push] failed to update last_sent_at'));
  } catch (err) {
    const statusCode = err.statusCode || err.status;
    if (statusCode === 410 || statusCode === 404) {
      // Dead endpoint — deactivate immediately
      logger.info({ subId: subscription.id, statusCode }, '[notify:push] dead endpoint, deactivating subscription');
      await db.query(
        `UPDATE push_subscriptions SET is_active = false WHERE id = $1`,
        [subscription.id],
      ).catch((dbErr) => logger.warn({ dbErr }, '[notify:push] failed to deactivate dead subscription'));
      return;
    }

    // Increment failure count; deactivate at >= 5
    const { rows } = await db.query(
      `UPDATE push_subscriptions
         SET failure_count = failure_count + 1,
             is_active = CASE WHEN failure_count + 1 >= 5 THEN false ELSE is_active END
       WHERE id = $1
       RETURNING failure_count, is_active`,
      [subscription.id],
    ).catch((dbErr) => {
      logger.warn({ dbErr }, '[notify:push] failed to increment failure_count');
      return { rows: [] };
    });

    const newCount = rows[0]?.failure_count;
    const stillActive = rows[0]?.is_active;
    logger.warn(
      { subId: subscription.id, statusCode, failureCount: newCount, isActive: stillActive },
      '[notify:push] send failed',
    );
  }
}

/**
 * sendTelegram — send a message to a telegram_chat_id from a push_subscriptions row.
 * Uses property's telegram_bot_token (from req.property) or falls back to env var.
 */
async function sendTelegram(chatId, message, propertyOrToken) {
  let botToken;
  if (typeof propertyOrToken === 'string') {
    botToken = propertyOrToken;
  } else {
    botToken = propertyOrToken?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;
  }

  if (!botToken) {
    logger.warn({ chatId }, '[notify:telegram] no bot token configured — skipping');
    return;
  }

  try {
    const result = await sendTelegramMessage(chatId, message, botToken);
    if (!result.ok) {
      logger.warn({ chatId, description: result.description }, '[notify:telegram] API returned error');
    }
  } catch (err) {
    logger.warn({ err: err.message, chatId }, '[notify:telegram] send failed');
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * getUserSubscriptions — load active push subscriptions for a single user.
 */
async function getUserSubscriptions(userId, db) {
  const { rows } = await db.query(
    `SELECT id, endpoint, p256dh, auth, platform, telegram_chat_id
       FROM push_subscriptions
      WHERE user_id = $1 AND is_active = true`,
    [userId],
  );
  return rows;
}

/**
 * getPropertyUsers — load users by role(s) for broadcast events.
 * @param {string[]} roles — e.g. ['security', 'admin']
 */
async function getPropertyUsers(roles, db) {
  const { rows } = await db.query(
    `SELECT uid, phone FROM users WHERE role = ANY($1) AND deleted_at IS NULL`,
    [roles],
  );
  return rows;
}

/**
 * getUserById — load a single user (for phone lookup etc.).
 */
async function getUserById(userId, db) {
  const { rows } = await db.query(
    `SELECT uid, phone FROM users WHERE uid = $1 AND deleted_at IS NULL`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * logNotification — fire-and-forget insert into notification_log.
 */
function logNotification({ userId, channel, eventType, payload, status, errorMessage }, db) {
  db.query(
    `INSERT INTO notification_log (user_id, channel, event_type, payload, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId || null,
      channel,
      eventType,
      payload ? JSON.stringify(payload) : null,
      status || 'sent',
      errorMessage || null,
    ],
  ).catch((err) => logger.warn({ err }, '[notify:log] insert failed'));
}

// ─── Per-event message builders ───────────────────────────────────────────────

function buildMessages(event, data) {
  switch (event) {
    case 'guest.arrived':
      return {
        push: { title: 'Гость прибыл', body: `${data.visitorName || 'Ваш гость'} у входа` },
        sms: `DomHub: ${data.visitorName || 'Ваш гость'} прибыл. Проверьте приложение.`,
        telegram: null,
      };
    case 'request.approved':
      return {
        push: { title: 'Заявка одобрена', body: data.requestSummary || 'Ваша заявка была одобрена' },
        sms: null,
        telegram: `<b>Заявка одобрена</b>\n${data.requestSummary || 'Ваша заявка была одобрена'}`,
      };
    case 'request.rejected':
      return {
        push: { title: 'Заявка отклонена', body: data.requestSummary || 'Ваша заявка была отклонена' },
        sms: null,
        telegram: `<b>Заявка отклонена</b>\n${data.requestSummary || 'Ваша заявка была отклонена'}`,
      };
    case 'announcement.published':
      return {
        push: { title: data.title || 'Новое объявление', body: data.body || '' },
        sms: null,
        telegram: null,
      };
    case 'blacklist.attempt':
      return {
        push: { title: 'Внимание: попытка прохода', body: `${data.visitorName || 'Неизвестное лицо'} в чёрном списке` },
        sms: `DomHub ALERT: ${data.visitorName || 'Неизвестное лицо'} в чёрном списке. Немедленная проверка.`,
        telegram: `<b>ВНИМАНИЕ: попытка прохода</b>\n${data.visitorName || 'Неизвестное лицо'} находится в чёрном списке`,
      };
    case 'package.arrived':
      return {
        push: { title: 'Посылка прибыла', body: 'Ваша посылка ожидает вас' },
        sms: 'DomHub: Ваша посылка ожидает на ресепшн.',
        telegram: null,
      };
    case 'booking.confirmed':
      return {
        push: { title: 'Бронирование подтверждено', body: data.spaceName || 'Ваша бронь подтверждена' },
        sms: null,
        telegram: null,
      };
    case 'meter.reminder':
      return {
        push: { title: 'Передайте показания счётчиков', body: 'До конца месяца осталось несколько дней' },
        sms: null,
        telegram: null,
      };
    case 'billing.overdue':
      return {
        push: { title: 'Просроченный платёж', body: 'У вас есть просроченный счёт' },
        sms: 'DomHub: Обнаружен просроченный платёж. Проверьте приложение.',
        telegram: null,
      };
    case 'request.completed':
      return {
        push: { title: 'Заявка выполнена', body: (data.requestSummary || 'Ваша заявка выполнена') + '. Оцените качество.' },
        sms: null,
        telegram: null,
      };
    case 'request.sla_overdue':
      {
        const slaLabel = data.slaHours ? `${data.slaHours}ч` : (data.slaProfile || data.eventType || '?');
        const dueLabel = data.dueAt ? `, срок: ${data.dueAt}` : '';
        const severityLabel = data.severity ? `, severity: ${data.severity}` : '';
        return {
          push: { title: 'SLA нарушен', body: `Заявка #${String(data.requestId || '').slice(0, 8)} просрочена (${slaLabel})` },
          sms: null,
          telegram: `<b>SLA нарушен</b>\nТип: ${data.requestType || '?'}, SLA: ${slaLabel}${severityLabel}${dueLabel}\nЗаявка: ${data.requestId || '?'}`,
        };
      }
    case 'package.reminder':
      return {
        push: { title: 'Посылка ждёт', body: 'Ваша посылка уже 2+ дня ожидает на ресепшн' },
        sms: 'DomHub: Ваша посылка более 2 дней ожидает на ресепшн. Заберите её.',
        telegram: null,
      };
    default:
      return {
        push: { title: 'Уведомление', body: String(event) },
        sms: null,
        telegram: null,
      };
  }
}

// ─── Channel routing map ──────────────────────────────────────────────────────

const EVENT_CHANNELS = {
  'guest.arrived':          { push: true, sms: true,  telegram: false },
  'request.approved':       { push: true, sms: false, telegram: true  },
  'request.rejected':       { push: true, sms: false, telegram: true  },
  'announcement.published': { push: true, sms: false, telegram: false },
  'blacklist.attempt':      { push: true, sms: true,  telegram: true  },
  'package.arrived':        { push: true, sms: true,  telegram: false },
  'booking.confirmed':      { push: true, sms: false, telegram: false },
  'meter.reminder':         { push: true, sms: false, telegram: false },
  'billing.overdue':        { push: true, sms: true,  telegram: false },
  'request.completed':      { push: true, sms: false, telegram: false },
  'request.sla_overdue':    { push: true, sms: false, telegram: true  },
  'package.reminder':       { push: true, sms: true,  telegram: false },
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * dispatch — main entry point for all notification sends.
 *
 * @param {string} event   — event name, e.g. 'request.approved'
 * @param {object} data    — event-specific fields:
 *   { userId?, userIds?, requestId?, propertySlug?,
 *     visitorName?, requestSummary?, title?, body?, spaceName?, ... }
 * @param {object} db      — pg pool for this property (req.db)
 * @param {object} [property] — property row (req.property), for telegram_bot_token
 */
async function dispatch(event, data, db, property) {
  // Notification failures must never throw to callers
  try {
    const channels = EVENT_CHANNELS[event] || { push: true, sms: false, telegram: false };
    const messages = buildMessages(event, data);

    // Determine recipient user IDs
    let userIds = [];
    if (data.userIds && Array.isArray(data.userIds)) {
      userIds = data.userIds;
    } else if (data.userId) {
      userIds = [data.userId];
    }

    // For broadcast events (no specific userId), load recipients by role
    if (userIds.length === 0) {
      const broadcastRoles = getBroadcastRoles(event);
      if (broadcastRoles.length > 0) {
        const users = await getPropertyUsers(broadcastRoles, db);
        userIds = users.map((u) => u.uid);
      }
    }

    if (userIds.length === 0) {
      logger.warn({ event, data }, '[notify] dispatch: no recipients found');
      return;
    }

    // Send to each recipient
    const sendPromises = userIds.map(async (userId) => {
      try {
        const subscriptions = await getUserSubscriptions(userId, db);

        const webSubs = subscriptions.filter((s) => s.platform === 'web');
        const tgSubs = subscriptions.filter(
          (s) => s.platform === 'telegram' && s.telegram_chat_id,
        );

        // Web push
        if (channels.push && messages.push && webSubs.length > 0) {
          await Promise.allSettled(
            webSubs.map((sub) => sendWebPush(sub, messages.push, db)),
          );
          logNotification({ userId, channel: 'push', eventType: event, payload: messages.push, status: 'sent' }, db);
        }

        // Telegram
        if (channels.telegram && messages.telegram && tgSubs.length > 0) {
          await Promise.allSettled(
            tgSubs.map((sub) => sendTelegram(sub.telegram_chat_id, messages.telegram, property)),
          );
          logNotification({ userId, channel: 'telegram', eventType: event, payload: { text: messages.telegram }, status: 'sent' }, db);
        }

        // SMS — load phone only when needed (avoid unnecessary DB query)
        if (channels.sms && messages.sms) {
          const user = await getUserById(userId, db);
          if (user?.phone) {
            try {
              await sendSms(user.phone, messages.sms);
              logNotification({ userId, channel: 'sms', eventType: event, payload: { message: messages.sms }, status: 'sent' }, db);
            } catch (smsErr) {
              logger.warn({ err: smsErr.message, userId }, '[notify:sms] send failed');
              logNotification({ userId, channel: 'sms', eventType: event, payload: { message: messages.sms }, status: 'failed', errorMessage: smsErr.message }, db);
            }
          }
        }
      } catch (userErr) {
        logger.warn({ err: userErr.message, userId, event }, '[notify] per-user send failed');
      }
    });

    await Promise.allSettled(sendPromises);

    // Webhook fanout — fire-and-forget, must never break the caller
    try {
      await webhookService.enqueueWebhookEvent(event, data, db);
    } catch (whErr) {
      logger.warn({ err: whErr.message, event }, '[notify] webhook enqueue failed (swallowed)');
    }
  } catch (err) {
    // Top-level catch — notifications must never break the caller
    logger.error({ err: err.message, event }, '[notify] dispatch error (swallowed)');
  }
}

/**
 * Returns the roles to use for broadcast events that have no explicit userId.
 */
function getBroadcastRoles(event) {
  switch (event) {
    case 'announcement.published':
      return ['owner', 'tenant'];
    case 'meter.reminder':
      return ['owner', 'tenant'];
    case 'blacklist.attempt':
      return ['security', 'admin'];
    case 'request.sla_overdue':
      return ['concierge', 'admin'];
    default:
      return [];
  }
}

module.exports = {
  dispatch,
  sendWebPush,
  sendTelegram,
  sendTelegramMessage,
  getUserSubscriptions,
  getPropertyUsers,
  logNotification,
  // Exposed for platform-v1 notificationDispatcher (Phase 5): same
  // event→channel map and message builders remain the single source of
  // truth in both paths (legacy inline and v1 outbox).
  buildMessages,
  EVENT_CHANNELS,
  getBroadcastRoles,
  getUserById,
};
