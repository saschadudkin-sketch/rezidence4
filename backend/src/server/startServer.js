'use strict';

const logger = require('../logger');
const sse = require('../sse');
const { startRuntimeJobs } = require('./runtimeJobs');
const { startTelegramBot, stopBot: stopTelegramBot } = require('../services/telegramBot');

async function startServer({ app, db, config }) {
  await db.assertSchemaCurrent();

  // FIX [RACE]: Redis pub/sub инициализируется ДО старта HTTP-сервера.
  // Ранее sseRedis.init() вызывался ПОСЛЕ app.listen() — первые SSE-клиенты,
  // подключившиеся в узком окне до завершения init(), не получали Redis-события.
  const sseRedis = require('../sse-redis');
  if (process.env.REDIS_URL) {
    sseRedis.init();
    logger.info('[server] Redis SSE pub/sub enabled');
  }

  const server = app.listen(config.port, () => logger.info(`[server] :${config.port} ready (prod=${config.isProd})`));

  const jobs = startRuntimeJobs({ db });

  // Start Telegram bot if configured (Phase 1)
  // The bot uses long-polling and is cancellable via stopTelegramBot()
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startTelegramBot(null, db.pool);
  }

  const shutdownTimeout = 10_000;
  let shuttingDown = false;

  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[server] ${signal}: graceful shutdown started`);

    jobs.stop();
    stopTelegramBot();
    sseRedis.shutdown();
    const { closeRedis } = require('../lib/redisClient');
    await closeRedis().catch(() => {});

    try { sse.closeAll(); } catch {}

    server.close(() => {
      logger.info('[server] HTTP server closed');
      db.pool.end(() => {
        logger.info('[server] DB pool closed');
        process.exit(0);
      });
    });

    setTimeout(() => {
      logger.warn('[server] graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, shutdownTimeout);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return { server, gracefulShutdown, jobs };
}

module.exports = {
  startServer,
};
