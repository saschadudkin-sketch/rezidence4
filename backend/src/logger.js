'use strict';
// FIX [DEVOPS-4]: структурированное логирование через pino
// JSON-формат с полями level, time, requestId, userId, method, url, statusCode, duration
const pino = require('pino');

const usePrettyTransport = process.env.NODE_ENV === 'development';
const defaultLevel = process.env.NODE_ENV === 'test' ? 'warn' : 'info';

const logger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
  // В development — красивый вывод, в остальных режимах (test/prod) — JSON
  transport: usePrettyTransport
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  formatters: {
    level(label) { return { level: label }; },
  },
  base: { service: 'residenze-backend' },
});

module.exports = logger;
