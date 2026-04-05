'use strict';
const logger = require('../logger');

/**
 * SmsService — abstraction over SMS providers with fallback chain.
 * Add providers to the PROVIDERS array in priority order.
 * If primary fails, falls back to secondary.
 */

async function sendViaSmsRu(phone, message) {
  const apiId = process.env.SMSRU_API_ID;
  if (!apiId || apiId === 'STUB') {
    logger.info({ phone }, '[sms:smsru] STUB mode — skipping send');
    return;
  }
  const digits = phone.replace(/\D/g, '');
  const body = new URLSearchParams({ api_id: apiId, to: digits, msg: message, json: '1' });
  const res = await fetch('https://sms.ru/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (data.status !== 'OK') {
    // Log only status_code, not full data (prevents API key leakage in logs)
    logger.error({ status: data.status, status_code: data.status_code }, '[sms:smsru] send failed');
    throw new Error('SMS провайдер sms.ru вернул ошибку: ' + data.status_code);
  }
  logger.info({ phone }, '[sms:smsru] sent');
}

// Fallback: stub provider logs warning (replace with real secondary provider)
async function sendViaFallback(phone, message) {
  const apiId = process.env.SMSRU_FALLBACK_API_ID;
  if (!apiId) {
    logger.warn({ phone }, '[sms:fallback] no secondary provider configured — SMS not sent');
    throw new Error('Нет резервного SMS-провайдера');
  }
  // Same sms.ru endpoint with fallback key (or swap for another provider)
  const digits = phone.replace(/\D/g, '');
  const body = new URLSearchParams({ api_id: apiId, to: digits, msg: message, json: '1' });
  const res = await fetch('https://sms.ru/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (data.status !== 'OK') {
    logger.error({ status: data.status, status_code: data.status_code }, '[sms:fallback] send failed');
    throw new Error('Резервный SMS-провайдер вернул ошибку');
  }
  logger.info({ phone }, '[sms:fallback] sent');
}

/**
 * sendSms — sends SMS with automatic fallback to secondary provider.
 * @param {string} phone — E.164 or Russian format
 * @param {string} message — SMS text
 */
async function sendSms(phone, message) {
  const providers = [sendViaSmsRu, sendViaFallback];
  let lastErr;
  for (const provider of providers) {
    try {
      await provider(phone, message);
      return; // success — stop trying
    } catch (err) {
      lastErr = err;
      logger.warn({ err: err.message }, '[sms] provider failed, trying fallback...');
    }
  }
  throw lastErr || new Error('Все SMS-провайдеры недоступны');
}

module.exports = { sendSms };
