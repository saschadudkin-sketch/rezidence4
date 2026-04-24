'use strict';

// platform-v1 channel dispatcher — Spec: notifications-outbox-spec.md §4.4.
//
// Централизованная точка, через которую worker обращается к каналу-адаптеру.
// Каждый adapter exposes `send({recipientAddress, payload, tenant, ...}) →
// {ok, error?, dead?}`.  Worker'у запрещено напрямую требовать `webPushAdapter`
// (или любой другой) — он всегда идёт через `dispatch(channel, args)`, чтобы:
//   1. неизвестный канал => централизованная ошибка (не crash worker'а);
//   2. mock-замена adapter'а в тестах — один require замещается.

const adapters = {
  web_push: require('./webPushAdapter'),
  sms:      require('./smsAdapter'),
  telegram: require('./telegramAdapter'),
  webhook:  require('./webhookAdapter'),
  email:    require('./emailAdapter'),
};

/**
 * dispatch — найти adapter по channel и вызвать `send`.
 *
 * @param {string} channel  one of 'web_push'|'sms'|'telegram'|'webhook'|'email'
 * @param {object} args     passed to adapter.send(args)
 * @returns {Promise<{ok:boolean, error?:string, dead?:boolean}>}
 */
async function dispatch(channel, args) {
  const adapter = adapters[channel];
  if (!adapter) {
    return {
      ok: false,
      error: `unknown_channel: ${channel}`,
      dead: true,
    };
  }
  return adapter.send(args);
}

function getAdapter(channel) {
  return adapters[channel] || null;
}

function listChannels() {
  return Object.keys(adapters);
}

module.exports = {
  dispatch,
  getAdapter,
  listChannels,
  // individual adapters re-exported for tests that want to stub `.send`:
  adapters,
};
