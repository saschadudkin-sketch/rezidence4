'use strict';
const { Pool } = require('pg');
const logger   = require('./logger');

const pool = new Pool({
  connectionString:        process.env.DATABASE_URL,
  max:                     20,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis:  5_000,
  statement_timeout:       30_000,
});

pool.on('error', (err) => logger.error({ err }, '[db] unexpected pool error'));

async function query(sql, params) {
  return pool.query(sql, params);
}

const { MIGRATIONS, LATEST_MIGRATION_ID } = require('./dbMigrations');

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

module.exports = { query, migrate, pool, assertSchemaCurrent, LATEST_MIGRATION_ID };
