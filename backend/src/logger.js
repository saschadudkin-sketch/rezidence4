'use strict';
// FIX [DEVOPS-4]: структурированное логирование через pino
// JSON-формат с полями level, time, requestId, userId, method, url, statusCode, duration
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // В разработке — красивый вывод, в продакшне — JSON
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  formatters: {
    level(label) { return { level: label }; },
  },
  base: { service: 'residenze-backend' },
});

module.exports = logger;
