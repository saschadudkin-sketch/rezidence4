'use strict';

// SEC [AUDIT-PII]: централизованный pino-redact для всего бэкенда.
//
// Контекст: notification-каналы (telegramAdapter, smsAdapter, emailAdapter,
// webhookAdapter) логируют PII в warn'ах при retry/fail (см. audit
// MEDIUM/M-1).  Без redact'а телефон/email/Telegram chat_id оседают в
// log-aggregation (Loki/ELK/Sentry) — деанонимизация резидентов при
// компрометации log infra.
//
// Pino redact подходит для top-level и одноуровневой вложенности; для более
// глубоких структур (например, payload.subscription.endpoint) перечисляем
// явные paths.  Wildcards (`*`) — match-any-key одного уровня, не recursive.
//
// Фильтр применяется ВЕЗДЕ (включая test-окружение) — чтобы случайные
// console-снапшоты в CI artifact'ах тоже не светили PII.

const REDACT_PATHS = Object.freeze([
  // ── PII (notification recipients) ──
  'phone',
  'chatId',
  'recipientAddress',
  'recipient_address',
  'email',
  'endpoint', // web-push endpoint URL содержит push-token
  // first-level nesting:  logger.warn({ chatId: ..., description })
  '*.phone',
  '*.chatId',
  '*.recipientAddress',
  '*.recipient_address',
  '*.email',
  '*.endpoint',
  // Common nested wrappers (payload, snapshot, subscription)
  'payload.endpoint',
  'snapshot.endpoint',
  'subscription.endpoint',
  'subscription.keys',
  // ── Secrets ──
  'token',
  'secret',
  'bot_token',
  'botToken',
  'password',
  'api_key',
  'apiKey',
  'authorization',
  '*.token',
  '*.secret',
  '*.bot_token',
  '*.botToken',
  '*.password',
  '*.api_key',
  '*.apiKey',
  '*.authorization',
  // HTTP headers могут попасть в логи через req-serializer
  'req.headers.cookie',
  'req.headers.authorization',
]);

function buildLoggerConfig(env = process.env) {
  const isDevelopment = env.NODE_ENV === 'development';
  const isJest = Boolean(env.JEST_WORKER_ID);
  const defaultLevel = env.NODE_ENV === 'test' ? 'warn' : 'info';

  return {
    level: env.LOG_LEVEL || defaultLevel,
    // В development — красивый вывод, в остальных режимах — JSON
    transport: isDevelopment && !isJest
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
    formatters: {
      level(label) { return { level: label }; },
    },
    base: { service: 'residenze-backend' },
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[REDACTED]',
      // remove: false (default) — оставляем ключ с censor значением, чтобы
      // shape лога был стабилен для downstream-парсеров.
    },
  };
}

module.exports = { buildLoggerConfig, REDACT_PATHS };
