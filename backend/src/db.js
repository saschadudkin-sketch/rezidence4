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

// ─────────────────────────────────────────────────────────────────────────────
// Versioned migrations
//
// БЫЛО: одна большая функция migrate() без учёта версий.
//   Проблемы:
//   - Нельзя откатить конкретный шаг (нет schema_migrations таблицы)
//   - При сбое на шаге 7 из 14 — БД в неконсистентном состоянии
//   - Повторный запуск выполняет «безопасные» ALTER IF NOT EXISTS заново,
//     тратя время и создавая шум в логах
//
// СТАЛО: каждый шаг — именованная запись в schema_migrations.
//   - Каждый шаг выполняется ОДИН РАЗ (идемпотентен через таблицу версий)
//   - При сбое: повторный запуск продолжит с неудавшегося шага
//   - История изменений схемы видна через SELECT * FROM schema_migrations
//   - Каждый шаг — отдельная транзакция: либо выполнен полностью, либо нет
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    id: '001_initial_schema',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          uid        TEXT PRIMARY KEY,
          phone      TEXT UNIQUE NOT NULL,
          name       TEXT NOT NULL,
          role       TEXT NOT NULL DEFAULT 'owner',
          apartment  TEXT,
          avatar     TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS otp_codes (
          id         BIGSERIAL PRIMARY KEY,
          phone      TEXT NOT NULL,
          code       TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used       BOOLEAN DEFAULT FALSE,
          attempts   INTEGER DEFAULT 0
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS requests (
          id               TEXT PRIMARY KEY,
          type             TEXT NOT NULL,
          category         TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'pending',
          created_by_uid   TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          created_by_name  TEXT,
          created_by_role  TEXT,
          created_by_apt   TEXT,
          visitor_name     TEXT,
          visitor_phone    TEXT,
          car_plate        TEXT,
          comment          TEXT,
          pass_duration    TEXT DEFAULT 'once',
          valid_until      TIMESTAMPTZ,
          scheduled_for    TIMESTAMPTZ,
          arrived_at       TIMESTAMPTZ,
          photos           TEXT[] DEFAULT '{}',
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_uid    ON requests(created_by_uid)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS request_history (
          id        BIGSERIAL PRIMARY KEY,
          req_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          by_name   TEXT,
          by_role   TEXT,
          label     TEXT,
          at        TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id         TEXT PRIMARY KEY,
          uid        TEXT NOT NULL,
          name       TEXT NOT NULL,
          role       TEXT,
          text       TEXT,
          photo      TEXT,
          reply_to   JSONB,
          reactions  JSONB DEFAULT '{}',
          edited     BOOLEAN DEFAULT FALSE,
          at         TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_at    ON chat_messages(at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_at_id ON chat_messages(at DESC, id DESC)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS perms (
          uid      TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          type     TEXT NOT NULL,
          items    JSONB DEFAULT '[]',
          PRIMARY KEY (uid, type)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS templates (
          uid    TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          items  JSONB DEFAULT '[]',
          PRIMARY KEY (uid)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS blacklist (
          id         TEXT PRIMARY KEY,
          name       TEXT,
          phone      TEXT,
          car_plate  TEXT,
          reason     TEXT,
          added_by   TEXT,
          added_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS visit_logs (
          id               TEXT PRIMARY KEY,
          user_id          TEXT,
          request_id       TEXT,
          visitor_name     TEXT,
          category         TEXT,
          car_plate        TEXT,
          created_by_apt   TEXT,
          created_by_name  TEXT,
          created_by_uid   TEXT,
          actor_name       TEXT,
          actor_role       TEXT,
          result           TEXT,
          reason           TEXT,
          request_snapshot JSONB,
          timestamp        TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_vlog_ts  ON visit_logs(timestamp DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_vlog_req ON visit_logs(request_id) WHERE request_id IS NOT NULL`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS token_revocations (
          jti         UUID PRIMARY KEY,
          revoked_at  TIMESTAMPTZ DEFAULT NOW(),
          expires_at  TIMESTAMPTZ NOT NULL
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_revoke_exp ON token_revocations(expires_at)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id          TEXT PRIMARY KEY,
          uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          expires_at  TIMESTAMPTZ NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_uid ON refresh_tokens(uid)`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sse_clients (
          id         TEXT PRIMARY KEY,
          user_uid   TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    },
  },

  {
    id: '002_indexes_and_soft_delete',
    async up(client) {
      // NOTE: otp_codes.attempts вошёл в CREATE TABLE в миграции 001.
      // ALTER здесь нужен только для БД, созданных старым кодом (до версионирования),
      // где таблица создавалась без колонки attempts. IF NOT EXISTS делает его safe.
      await client.query(`ALTER TABLE otp_codes   ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE requests    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_deleted    ON requests(deleted_at) WHERE deleted_at IS NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_created_at ON requests(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_name     ON users(name)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bl_added_at    ON blacklist(added_at DESC)`);
    },
  },
];

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

module.exports = { query, migrate, pool };
