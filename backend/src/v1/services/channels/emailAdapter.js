'use strict';

// platform-v1 email channel adapter — Spec: notifications-outbox-spec.md §4.4.
//
// Stub-реализация.  Email-канал зарезервирован в CHECK constraint'ах outbox'а,
// но конкретный провайдер (SMTP / SES / SendGrid) выбирается в Фазе 5+ —
// см. BACKLOG «email-notifications-v1».  До тех пор adapter возвращает
// `ok:false, dead:true` — строка уйдёт в dead без ретраев, admin увидит
// её в DLQ и поймёт, что email ещё не поддерживается.
//
// Мы НЕ бросаем из send(), чтобы worker не падал при случайном enqueue
// с channel='email'; но `dead:true` означает «не ретраить, просто pipe'ни
// в DLQ».  Это минимальный honest-path без ложного `ok:true`.

const logger = require('../../../logger');

async function send({ recipientAddress, payload }) {
  logger.warn(
    { recipientAddress, event: payload?.event },
    '[outbox:email] STUB — email adapter not yet implemented',
  );
  return {
    ok: false,
    error: 'email_adapter_not_implemented',
    dead: true,
  };
}

module.exports = { send };
