'use strict';

// platform-v1 telegram channel adapter — Spec: notifications-outbox-spec.md §4.4.
//
// Перенос `sendTelegramMessage` из legacy notificationService.  Bot-token
// резолвится в следующем порядке:
//   1. tenant.property.telegram_bot_token (per-property, хранится в platform DB)
//   2. process.env.TELEGRAM_BOT_TOKEN     (global fallback для dev)
// Если ни тот ни другой не задан — возвращаем { ok:false, error: 'no_bot_token' }.
// Worker не ретраит это агрессивно: через 6 попыток попадает в dead, admin
// увидит систематическую ошибку в DLQ и добавит token.
//
// `recipientAddress` для telegram — chat_id (строка, Telegram API принимает
// int64 в строке).  Сообщение берётся из payload.text или payload.body.

const logger = require('../../../logger');

/**
 * Low-level helper — static POST в Bot API.  Вынесен отдельно, чтобы тесты
 * могли подменить `fetch` без замены всего adapter'а.
 */
async function callTelegramApi(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

/**
 * send — доставить Telegram-сообщение одному chat_id.
 */
async function send({ recipientAddress, payload, tenant }) {
  if (!recipientAddress) {
    return { ok: false, error: 'chat_id_required' };
  }
  const text = payload?.text || payload?.body || '';
  if (!text) {
    return { ok: false, error: 'empty_message' };
  }

  const botToken = tenant?.property?.telegram_bot_token
    || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    logger.warn(
      { chatId: recipientAddress },
      '[outbox:telegram] no bot token configured',
    );
    return { ok: false, error: 'no_bot_token' };
  }

  try {
    const result = await callTelegramApi(botToken, recipientAddress, text);
    if (!result || !result.ok) {
      const description = result?.description || 'unknown';
      logger.warn(
        { chatId: recipientAddress, description },
        '[outbox:telegram] API returned error',
      );
      return { ok: false, error: `telegram_api: ${description}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn(
      { err: err.message, chatId: recipientAddress },
      '[outbox:telegram] send failed',
    );
    return { ok: false, error: err.message || 'telegram_send_failed' };
  }
}

module.exports = { send, callTelegramApi };
