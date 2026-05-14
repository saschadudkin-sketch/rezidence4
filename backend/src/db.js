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
// platform-v1 property-DB migrations (Фаза 2+).  Run after the legacy array
// so legacy tables exist before any v1 FK that might later reference them.
// IDs are prefixed `v1_` and never collide with legacy IDs in schema_migrations.
const { V1_PROPERTY_MIGRATIONS } = require('./v1/migrations');

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
  // Legacy + v1 migrations share `schema_migrations` so idempotency is
  // tracked uniformly; the v1 prefix guarantees no ID collision.
  const ALL_MIGRATIONS = [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS];
  for (const migration of ALL_MIGRATIONS) {
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
  const requiredPropertyIds = [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS]
    .map((migration) => migration.id)
    .filter(Boolean);
  if (!requiredPropertyIds.length) return;
  const { rows } = await query(
    `SELECT id FROM schema_migrations WHERE id = ANY($1::text[])`,
    [requiredPropertyIds],
  );
  const appliedDefaultIds = new Set(rows.map((row) => row.id));
  const missingDefault = requiredPropertyIds.find((id) => !appliedDefaultIds.has(id));
  if (missingDefault) {
    const err = new Error(`Database schema is outdated. Run migrations before starting the server (missing ${missingDefault}).`);
    err.code = 'SCHEMA_OUTDATED';
    throw err;
  }

  if (!process.env.PLATFORM_DB_URL) return;

  const platformDb = getPlatformDb();
  const requiredPlatformIds = PLATFORM_MIGRATIONS.map((migration) => migration.id).filter(Boolean);
  if (requiredPlatformIds.length) {
    const { rows: platformRows } = await platformDb.query(
      `SELECT id FROM platform_schema_migrations WHERE id = ANY($1::text[])`,
      [requiredPlatformIds],
    );
    const appliedPlatformIds = new Set(platformRows.map((row) => row.id));
    const missingPlatform = requiredPlatformIds.find((id) => !appliedPlatformIds.has(id));
    if (missingPlatform) {
      const err = new Error(`Platform schema is outdated. Run platform migrations before starting the server (missing ${missingPlatform}).`);
      err.code = 'PLATFORM_SCHEMA_OUTDATED';
      throw err;
    }
  }

  const { rows: properties } = await platformDb.query(
    `SELECT slug, db_connection_url
       FROM properties
      WHERE COALESCE(is_active, true) = true
        AND COALESCE(status, 'active') <> 'terminated'
      ORDER BY slug`,
  );

  const seenConnectionStrings = new Set([process.env.DATABASE_URL].filter(Boolean));
  for (const property of properties) {
    if (!property.db_connection_url) continue;
    if (seenConnectionStrings.has(property.db_connection_url)) continue;
    seenConnectionStrings.add(property.db_connection_url);

    const tenantPool = new Pool({
      connectionString: property.db_connection_url,
      max: 1,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    try {
      const { rows: tenantRows } = await tenantPool.query(
        `SELECT id FROM schema_migrations WHERE id = ANY($1::text[])`,
        [requiredPropertyIds],
      );
      const applied = new Set(tenantRows.map((row) => row.id));
      const missing = requiredPropertyIds.find((id) => !applied.has(id));
      if (missing) {
        const err = new Error(`Tenant schema is outdated for '${property.slug}'. Run tenant migrations before starting the server (missing ${missing}).`);
        err.code = 'TENANT_SCHEMA_OUTDATED';
        err.propertySlug = property.slug;
        throw err;
      }
    } finally {
      await tenantPool.end().catch(() => {});
    }
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
