'use strict';

// platform-v1 web_push channel adapter — Spec: notifications-outbox-spec.md §4.4, §7 Q7.
//
// Перенесён as-is из legacy `notificationService.sendWebPush` с двумя
// изменениями:
//   - Интерфейс `send({recipientAddress, payload, tenant})` вместо
//     (subscription, payload, db).
//   - Dead-endpoint (410/404) поднимает `dead: true` в возврате — worker
//     НЕ ретраит такую строку (помечает 'sent' без отправки? нет —
//     помечает 'dead' с last_error='endpoint_gone'); отдельно adapter
//     деактивирует строку push_subscriptions (is_active=false), как в legacy.
//
// `recipientAddress` для web_push — JSON-строка:
//   `{"subscription_id": UUID, "endpoint": "...", "p256dh": "...", "auth": "..."}`
// Producer формирует её при fan-out'е снимком `push_subscriptions` row.
// Альтернатива — хранить subscription_id и join'ить в worker'е — не
// используем, потому что между enqueue и send может пройти час, subscription
// row может быть удалён/отозван: snapshot-подход устойчивее.

const logger = require('../../../logger');

// Ленивая инициализация web-push (как в legacy) — VAPID может быть
// не настроен на этапе unit-тестов, это не должно ломать импорт.
let webpushInstance = null;

function getWebPush() {
  if (webpushInstance !== null) return webpushInstance;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.warn('[outbox:web_push] VAPID env vars not set — adapter disabled');
    webpushInstance = false;
    return false;
  }
  try {
    const wp = require('web-push');
    wp.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    webpushInstance = wp;
    return wp;
  } catch (err) {
    logger.warn({ err: err.message }, '[outbox:web_push] web-push module not installed');
    webpushInstance = false;
    return false;
  }
}

// Reset helper для тестов — сбрасывает кэш.  Не экспортируется в prod API.
function __resetForTests() {
  webpushInstance = null;
}

function parseSnapshot(recipientAddress) {
  if (!recipientAddress) throw new Error('recipientAddress required for web_push');
  if (typeof recipientAddress !== 'string') {
    throw new Error('web_push recipientAddress must be JSON string');
  }
  let parsed;
  try {
    parsed = JSON.parse(recipientAddress);
  } catch (err) {
    throw new Error(`web_push recipientAddress invalid JSON: ${err.message}`);
  }
  if (!parsed.endpoint || !parsed.p256dh || !parsed.auth) {
    throw new Error('web_push recipientAddress missing endpoint/p256dh/auth');
  }
  return parsed;
}

/**
 * send — доставить web-push уведомление одному подписчику.
 *
 * @param {object}   args
 * @param {string}   args.recipientAddress  JSON snapshot (см. выше)
 * @param {object}   args.payload           { title, body, url? }
 * @param {object}   args.tenant            { db, property }
 * @returns {Promise<{ok:boolean, error?:string, dead?:boolean}>}
 */
async function send({ recipientAddress, payload, tenant }) {
  const wp = getWebPush();
  if (!wp) {
    return { ok: false, error: 'vapid_not_configured' };
  }

  let snapshot;
  try {
    snapshot = parseSnapshot(recipientAddress);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const subscription = {
    endpoint: snapshot.endpoint,
    keys: { p256dh: snapshot.p256dh, auth: snapshot.auth },
  };

  try {
    await wp.sendNotification(subscription, JSON.stringify(payload || {}));

    // success → обновляем last_sent_at, сбрасываем failure_count.  Если
    // subscription_id снимка больше нет в БД (подписку удалили), UPDATE =
    // no-op — это норма, не ломаем outbox.
    if (snapshot.subscription_id && tenant?.db) {
      tenant.db.query(
        `UPDATE push_subscriptions
            SET last_sent_at = NOW(), failure_count = 0
          WHERE id = $1`,
        [snapshot.subscription_id],
      ).catch((err) => logger.warn(
        { err: err.message, subId: snapshot.subscription_id },
        '[outbox:web_push] failed to update last_sent_at (non-fatal)',
      ));
    }
    return { ok: true };
  } catch (err) {
    const statusCode = err.statusCode || err.status;

    if (statusCode === 410 || statusCode === 404) {
      // Dead endpoint — деактивируем subscription, помечаем dead в возврате.
      if (snapshot.subscription_id && tenant?.db) {
        tenant.db.query(
          `UPDATE push_subscriptions SET is_active = false WHERE id = $1`,
          [snapshot.subscription_id],
        ).catch((dbErr) => logger.warn(
          { err: dbErr.message, subId: snapshot.subscription_id },
          '[outbox:web_push] failed to deactivate dead subscription',
        ));
      }
      logger.info(
        { subId: snapshot.subscription_id, statusCode },
        '[outbox:web_push] dead endpoint',
      );
      return { ok: false, error: 'endpoint_gone', dead: true };
    }

    // Прочая ошибка — инкрементим failure_count в push_subscriptions,
    // деактивируем при >= 5 (as legacy).  Сам outbox worker решит retry
    // vs dead по своему attempt_count.
    if (snapshot.subscription_id && tenant?.db) {
      tenant.db.query(
        `UPDATE push_subscriptions
            SET failure_count = failure_count + 1,
                is_active = CASE WHEN failure_count + 1 >= 5 THEN false ELSE is_active END
          WHERE id = $1`,
        [snapshot.subscription_id],
      ).catch((dbErr) => logger.warn(
        { err: dbErr.message, subId: snapshot.subscription_id },
        '[outbox:web_push] failed to bump failure_count',
      ));
    }

    return {
      ok: false,
      error: err.message || `web_push_${statusCode || 'unknown'}`,
    };
  }
}

module.exports = {
  send,
  // exposed only for tests:
  __resetForTests,
  parseSnapshot,
};
