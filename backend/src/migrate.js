'use strict';
/**
 * migrate.js — отдельная точка запуска миграций
 *
 * FIX [ARCH-1]: миграции вынесены из start() в отдельный скрипт.
 * Запускается до старта приложения через docker-compose command или CI-шаг:
 *
 *   node src/migrate.js
 *
 * docker-compose: command: sh -c "node src/migrate.js && node src/index.js"
 *
 * Преимущества:
 *   - При горизонтальном масштабировании DDL-операции выполняются один раз,
 *     а не конкурентно на нескольких репликах
 *   - В CI можно прогонять миграции отдельным шагом перед тестами
 *   - Падение миграции не запускает сервер с некорректной схемой
 */
require('dotenv').config();
const logger = require('./logger');
const db     = require('./db');

async function run() {
  try {
    logger.info('[migrate] starting...');
    await db.migrate();
    logger.info('[migrate] done');
    process.exit(0);
  } catch (err) {
    logger.fatal({ err }, '[migrate] FAILED');
    process.exit(1);
  }
}

run();
