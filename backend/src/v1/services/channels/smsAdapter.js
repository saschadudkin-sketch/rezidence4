'use strict';

// platform-v1 sms channel adapter — Spec: notifications-outbox-spec.md §4.4.
//
// Тонкая обёртка над legacy `services/smsService.sendSms(phone, message)`.
// Эта логика (sms.ru primary → fallback) не воспроизводится в v1: у нас
// переходный период, legacy-сервис продолжает быть источником истины для
// SMS-провайдеров до завершения split'а.  Этот adapter только преобразует
// outbox-контракт в вызов legacy-функции.
//
// `recipientAddress` для sms — телефон в E.164 или российском формате.
// Сообщение берётся из `payload.message` или `payload.body`.  Producer
// (notificationService-wrapper в Фазе 5) выбирает формат при enqueue.

const logger = require('../../../logger');
const { sendSms } = require('../../../services/smsService');

/**
 * send — доставить SMS.
 *
 * @param {object} args
 * @param {string} args.recipientAddress   phone
 * @param {object} args.payload            { message? | body? }
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function send({ recipientAddress, payload }) {
  if (!recipientAddress) {
    return { ok: false, error: 'phone_required' };
  }
  const message = payload?.message || payload?.body || '';
  if (!message) {
    return { ok: false, error: 'empty_message' };
  }

  try {
    await sendSms(recipientAddress, message);
    return { ok: true };
  } catch (err) {
    logger.warn(
      { err: err.message, phone: recipientAddress },
      '[outbox:sms] send failed',
    );
    return { ok: false, error: err.message || 'sms_send_failed' };
  }
}

module.exports = { send };
