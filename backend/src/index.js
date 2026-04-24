'use strict';
require('dotenv').config();

const db = require('./db');
const { validateConfig, getAppConfig } = require('./config/appConfig');
const { createApp } = require('./app/createApp');
const { startServer } = require('./server/startServer');
const logger = require('./logger');
const { initBackendSentry } = require('./sentry');

const config = getAppConfig(process.env);
validateConfig(process.env, config.isProd);
initBackendSentry();

// AUDIT #6: crash-only на unhandled error — без этих хэндлеров process
// просто молча падает с exit-code 1 без лога → alerting не видит причину,
// а с Sentry-init'ом выше мы ещё и теряем stack.  Container orchestrator
// (docker/compose → systemd) перезапустит — это ожидаемый цикл recovery.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err }, '[fatal] unhandledRejection');
  // flush Pino async transport и exit non-zero, чтобы runtime заметил crash
  setTimeout(() => process.exit(1), 100).unref();
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[fatal] uncaughtException');
  setTimeout(() => process.exit(1), 100).unref();
});

const app = createApp({ config, db });

async function start() {
  try {
    return await startServer({ app, db, config });
  } catch (err) {
    logger.fatal({ err }, '[fatal] startup failed');
    process.exit(1);
  }
}

start();

module.exports = { app, start, config };
