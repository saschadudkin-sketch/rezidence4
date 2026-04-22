'use strict';
const { Pool } = require('pg');
const logger   = require('./logger');

const pool = new Pool({
  connectionString:        process.env.DATABASE_URL,
  max:                     20,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis:  5_000,
  // FIX [PERF]: снижен с 30s до 10s.
  // 30s позволяло медленным запросам удерживать соединение из пула, при пике нагрузки
  // пул из 20 соединений исчерпывался. Для веб-запросов 10s — достаточный потолок.
  // Долгоживущие операции (migrate, seed) переопределяют timeout локально через client.query().
  statement_timeout:       10_000,
});

pool.on('error', (err) => logger.error({ err }, '[db] unexpected pool error'));

async function query(sql, params) {
  return pool.query(sql, params);
}

const { MIGRATIONS, LATEST_MIGRATION_ID } = require('./dbMigrations');

// Platform database pool for property registry
let platformPool = null;

function getPlatformDb() {
  if (!platformPool) {
    const platformDbUrl = process.env.PLATFORM_DB_URL;
    if (!platformDbUrl) {
      throw new Error('PLATFORM_DB_URL must be set for multi-tenant operations');
    }

    platformPool = new Pool({
      connectionString: platformDbUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });

    platformPool.on('error', (err) => logger.error({ err }, '[platform-db] unexpected pool error'));
    logger.info('[platform-db] connected to platform registry database');
  }

  return platformPool;
}

async function migrate() {
  logger.info('[db] running versioned migrations...');

  // Создаём таблицу версий если не существует (единственная bootstrapping операция)
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: applied } = await query(`SELECT id FROM schema_migrations`);
  const appliedIds = new Set(applied.map(r => r.id));

  let ran = 0;
  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      logger.info(`[migrate] skip ${migration.id} (already applied)`);
      continue;
    }

    // Каждая миграция — отдельная транзакция: всё или ничего
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(
        `INSERT INTO schema_migrations(id) VALUES($1)`,
        [migration.id],
      );
      await client.query('COMMIT');
      logger.info(`[migrate] applied ${migration.id}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.fatal({ err }, `[migrate] FAILED at ${migration.id} — rolled back`);
      throw err; // прерываем — не запускаем сервер с частичной схемой
    } finally {
      client.release();
    }
  }

  logger.info(`[migrate] done (${ran} new, ${appliedIds.size} skipped)`);
}

// Platform database migrations
const { PLATFORM_MIGRATIONS, LATEST_PLATFORM_MIGRATION_ID } = require('./platformMigrations');

async function migratePlatform() {
  if (!process.env.PLATFORM_DB_URL) {
    logger.info('[platform-migrate] PLATFORM_DB_URL not set, skipping platform migrations');
    return;
  }

  logger.info('[platform-migrate] running platform registry migrations...');
  const platformDb = getPlatformDb();

  // Create platform migrations tracking table
  await platformDb.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: applied } = await platformDb.query(`SELECT id FROM platform_schema_migrations`);
  const appliedIds = new Set(applied.map(r => r.id));

  let ran = 0;
  for (const migration of PLATFORM_MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      logger.info(`[platform-migrate] skip ${migration.id} (already applied)`);
      continue;
    }

    const client = await platformDb.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(
        `INSERT INTO platform_schema_migrations(id) VALUES($1)`,
        [migration.id],
      );
      await client.query('COMMIT');
      logger.info(`[platform-migrate] applied ${migration.id}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.fatal({ err }, `[platform-migrate] FAILED at ${migration.id} — rolled back`);
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info(`[platform-migrate] done (${ran} new, ${appliedIds.size} skipped)`);
}

async function assertSchemaCurrent() {
  if (!LATEST_MIGRATION_ID) return;
  const { rows } = await query(
    `SELECT 1 FROM schema_migrations WHERE id=$1`,
    [LATEST_MIGRATION_ID],
  );
  if (!rows.length) {
    const err = new Error(`Database schema is outdated. Run migrations before starting the server (missing ${LATEST_MIGRATION_ID}).`);
    err.code = 'SCHEMA_OUTDATED';
    throw err;
  }
}

module.exports = {
  query,
  migrate,
  migratePlatform,
  pool,
  getPlatformDb,
  assertSchemaCurrent,
  LATEST_MIGRATION_ID,
  LATEST_PLATFORM_MIGRATION_ID
};
