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
