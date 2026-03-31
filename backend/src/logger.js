'use strict';
// FIX [DEVOPS-4]: структурированное логирование через pino
// JSON-формат с полями level, time, requestId, userId, method, url, statusCode, duration
const pino = require('pino');
const { buildLoggerConfig } = require('./loggerConfig');

const logger = pino(buildLoggerConfig(process.env));

module.exports = logger;
