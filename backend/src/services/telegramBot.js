'use strict';

/**
 * services/telegramBot.js — per-property Telegram bot via HTTP polling (Phase 1).
 *
 * Uses Node's built-in fetch (Node 18+) — no library dependency required.
 * Polling mode: long-poll getUpdates with timeout=25s.
 *
 * Start: startTelegramBot(property?) — called from startServer.js
 * Stop:  stopBot() — called during graceful shutdown
 *
 * /start <linkToken> command:
 *   - Reads Redis key tg_link:<token> → userId
 *   - Upserts push_subscriptions (platform='telegram', telegram_chat_id)
 *   - Replies in Russian confirming connection
 */

const logger = require('../logger');
const { getRedis } = require('../lib/redisClient');
const { sendTelegramMessage } = require('./notificationService');

// ─── State ────────────────────────────────────────────────────────────────────

let _pollTimeout = null;  // handle for the next scheduled poll
let _running = false;
let _botToken = null;
let _dbPool = null;       // pg pool for the default property (for subscription upsert)

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function apiCall(method, body, token) {
  const tok = token || _botToken;
  if (!tok) throw new Error('No bot token configured');

  const res = await fetch(`https://api.telegram.org/bot${tok}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getUpdates(offset, token) {
  return apiCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, token);
}

// ─── /start handler ───────────────────────────────────────────────────────────

async function handleStartCommand(chatId, linkToken, username, botToken) {
  const redis = getRedis();
  if (!redis) {
    await sendTelegramMessage(chatId, '❌ Сервис временно недоступен. Попробуйте позже.', botToken);
    return;
  }

  const redisKey = `tg_link:${linkToken}`;
  let userId;
  try {
    userId = await redis.get(redisKey);
  } catch (err) {
    logger.warn({ err: err.message }, '[telegram-bot] redis get failed');
    await sendTelegramMessage(chatId, '❌ Сервис временно недоступен. Попробуйте позже.', botToken);
    return;
  }

  if (!userId) {
    await sendTelegramMessage(
      chatId,
      '❌ Ссылка недействительна или истекла. Сгенерируйте новую ссылку в приложении DomHub.',
      botToken,
    );
    return;
  }

  // Consume the token immediately to prevent replay
  try {
    await redis.del(redisKey);
  } catch (err) {
    logger.warn({ err: err.message }, '[telegram-bot] failed to delete link token from redis');
  }

  // Upsert subscription into the property DB
  if (_dbPool) {
    try {
      await _dbPool.query(
        `INSERT INTO push_subscriptions
           (user_id, endpoint, p256dh, auth, platform, telegram_chat_id, is_active, failure_count)
         VALUES ($1, $2, '', '', 'telegram', $3, true, 0)
         ON CONFLICT (user_id, endpoint)
         DO UPDATE SET
           telegram_chat_id = EXCLUDED.telegram_chat_id,
           is_active        = true,
           failure_count    = 0`,
        [
          userId,
          // Use a stable, unique endpoint surrogate for telegram subscriptions
          `telegram:${chatId}`,
          chatId,
        ],
      );

      logger.info({ userId, chatId }, '[telegram-bot] linked telegram subscription');
      await sendTelegramMessage(
        chatId,
        '✅ Telegram подключён. Вы будете получать уведомления здесь.',
        botToken,
      );
    } catch (err) {
      logger.error({ err: err.message, userId, chatId }, '[telegram-bot] failed to upsert subscription');
      await sendTelegramMessage(
        chatId,
        '❌ Не удалось подключить Telegram. Попробуйте ещё раз.',
        botToken,
      );
    }
  } else {
    // No DB pool available — still confirm to user, linking will retry
    logger.warn({ userId, chatId }, '[telegram-bot] no DB pool available to save subscription');
    await sendTelegramMessage(
      chatId,
      '✅ Telegram подключён. Вы будете получать уведомления здесь.',
      botToken,
    );
  }
}

// ─── Update processor ─────────────────────────────────────────────────────────

async function processUpdate(update, botToken) {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  const text = message.text.trim();

  // Handle /start <linkToken>
  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const linkToken = parts[1] || '';

    if (!linkToken) {
      await sendTelegramMessage(
        chatId,
        'Добро пожаловать в DomHub! Для подключения уведомлений откройте ссылку из приложения.',
        botToken,
      );
      return;
    }

    await handleStartCommand(chatId, linkToken, message.from?.username, botToken);
    return;
  }

  // Default response for unhandled commands
  await sendTelegramMessage(
    chatId,
    'DomHub Bot: используйте ссылку из приложения для подключения уведомлений.',
    botToken,
  );
}

// ─── Long-poll loop ────────────────────────────────────────────────────────────

async function pollLoop(offset, botToken) {
  if (!_running) return;

  try {
    const data = await getUpdates(offset, botToken);

    if (!data.ok) {
      logger.warn({ description: data.description }, '[telegram-bot] getUpdates error');
      scheduleNextPoll(offset, botToken, 5000);
      return;
    }

    const updates = data.result || [];
    let nextOffset = offset;

    for (const update of updates) {
      nextOffset = Math.max(nextOffset, update.update_id + 1);
      try {
        await processUpdate(update, botToken);
      } catch (err) {
        logger.warn({ err: err.message, updateId: update.update_id }, '[telegram-bot] processUpdate error');
      }
    }

    scheduleNextPoll(nextOffset, botToken, 0);
  } catch (err) {
    logger.warn({ err: err.message }, '[telegram-bot] poll error, retrying in 5s');
    scheduleNextPoll(offset, botToken, 5000);
  }
}

function scheduleNextPoll(offset, botToken, delayMs) {
  if (!_running) return;
  _pollTimeout = setTimeout(() => pollLoop(offset, botToken), delayMs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * startTelegramBot — initialise long-poll loop.
 * @param {object} [property]  — property row (has telegram_bot_token), or omit to use env var
 * @param {object} [dbPool]    — pg pool for subscription upsert (req.db / property pool)
 */
function startTelegramBot(property, dbPool) {
  const token = property?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    logger.info('[telegram-bot] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }

  if (_running) {
    logger.warn('[telegram-bot] already running, ignoring duplicate startTelegramBot call');
    return;
  }

  _botToken = token;
  _dbPool = dbPool || null;
  _running = true;

  logger.info('[telegram-bot] starting long-poll loop');
  pollLoop(0, token);
}

/**
 * stopBot — cancel the pending poll and mark as stopped.
 * Called during graceful shutdown.
 */
function stopBot() {
  _running = false;
  if (_pollTimeout) {
    clearTimeout(_pollTimeout);
    _pollTimeout = null;
  }
  logger.info('[telegram-bot] stopped');
}

// Re-export sendTelegramMessage so callers don't need to import notificationService
module.exports = {
  startTelegramBot,
  stopBot,
  sendTelegramMessage,
};
