'use strict';

function buildLoggerConfig(env = process.env) {
  const isDevelopment = env.NODE_ENV === 'development';
  const defaultLevel = env.NODE_ENV === 'test' ? 'warn' : 'info';

  return {
    level: env.LOG_LEVEL || defaultLevel,
    // В development — красивый вывод, в остальных режимах — JSON
    transport: isDevelopment
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
    formatters: {
      level(label) { return { level: label }; },
    },
    base: { service: 'residenze-backend' },
  };
}

module.exports = { buildLoggerConfig };
