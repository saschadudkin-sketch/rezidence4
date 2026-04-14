'use strict';

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
      await client.query(`CREATE INDEX IF NOT EXISTS idx_request_history_req_id ON request_history(req_id)`);
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
          id_hash     TEXT,
          uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          expires_at  TIMESTAMPTZ NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_uid ON refresh_tokens(uid)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_id_hash_unique ON refresh_tokens(id_hash) WHERE id_hash IS NOT NULL`);
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
      await client.query(`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS id_hash TEXT`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_id_hash_unique ON refresh_tokens(id_hash) WHERE id_hash IS NOT NULL`);
      await client.query(`ALTER TABLE requests    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_deleted    ON requests(deleted_at) WHERE deleted_at IS NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_req_created_at ON requests(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_name     ON users(name)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bl_added_at    ON blacklist(added_at DESC)`);
    },
  },
  {
    id: '003_users_soft_delete',
    async up(client) {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL`);
    },
  },
  {
    id: '004_composite_indexes',
    // FIX [PERF]: составные частичные индексы для горячих путей запросов.
    //
    // ПРОБЛЕМА: RequestsService.list() для жильцов (~80% запросов):
    //   WHERE created_by_uid=$1 AND deleted_at IS NULL ORDER BY created_at DESC
    // Раньше PostgreSQL использовал только один из двух одноколоночных индексов
    // (idx_req_uid или idx_req_created_at) + filter/sort по второму в памяти.
    // При 10000+ заявок — full index scan + sort = заметная деградация.
    //
    // РЕШЕНИЕ: составной частичный индекс покрывает весь WHERE + ORDER BY
    // одним index range scan без дополнительной сортировки.
    async up(client) {
      // Для жильцов: WHERE created_by_uid=$1 AND deleted_at IS NULL ORDER BY created_at DESC
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_req_uid_active_created
        ON requests(created_by_uid, created_at DESC)
        WHERE deleted_at IS NULL
      `);
      // Для персонала: WHERE deleted_at IS NULL ORDER BY created_at DESC
      // (уже есть idx_req_created_at, но без частичного предиката deleted_at IS NULL)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_req_active_created
        ON requests(created_at DESC)
        WHERE deleted_at IS NULL
      `);
    },
  },
  {
    id: '005_users_updated_at',
    // FIX [BUG]: routes/users.js использовал updated_at=NOW() в DELETE и PATCH /restore,
    // но таблица users не имела этой колонки — любой вызов падал с
    // "column updated_at of relation users does not exist".
    async up(client) {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
      // Обновляем существующие строки значением created_at как разумным дефолтом
      await client.query(`UPDATE users SET updated_at = created_at WHERE updated_at IS NULL`);
    },
  },
  {
    id: '006_otp_codes_lookup_index',
    // FIX [PERF]: composite partial index for the hot /send-otp and /verify-otp paths.
    // Queries filter on phone + expires_at + used=FALSE; without this index PostgreSQL
    // falls back to a seq scan on otp_codes as the table grows unboundedly.
    // The partial predicate (WHERE used = FALSE) keeps the index small — used rows
    // are excluded and are cleaned up by the periodic OTP cleanup job.
    async up(client) {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_otp_codes_lookup
          ON otp_codes(phone, expires_at, used)
          WHERE used = FALSE
      `);
    },
  },
  {
    id: '007_upload_security_metadata',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS upload_objects (
          id         BIGSERIAL PRIMARY KEY,
          owner_uid  TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          filename   TEXT NOT NULL UNIQUE,
          mime_type  TEXT,
          byte_size  INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_upload_objects_owner ON upload_objects(owner_uid, created_at DESC)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS upload_access_audit (
          id         BIGSERIAL PRIMARY KEY,
          filename   TEXT NOT NULL,
          uid        TEXT,
          decision   TEXT NOT NULL,
          reason     TEXT,
          access_via TEXT,
          ip         TEXT,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_upload_access_audit_file ON upload_access_audit(filename, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_upload_access_audit_uid ON upload_access_audit(uid, created_at DESC)`);
    },
  },
  {
    // FIX [PERF]: GIN-индекс для поиска по тексту чата.
    // ILIKE '%term%' без индекса — full table scan. При 100k+ сообщений это O(n).
    // pg_trgm GIN позволяет ILIKE с leading wildcard использовать индекс (O(log n)).
    id: '008_chat_search_trgm_index',
    async up(client) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_text_trgm
        ON chat_messages USING GIN (text gin_trgm_ops)
      `);
    },
  },
  {
    id: '009_request_history_req_id_index',
    async up(client) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_request_history_req_id ON request_history(req_id)`);
    },
  },
  {
    id: '010_chat_reactions_constraint',
    async up(client) {
      await client.query(`
        CREATE OR REPLACE FUNCTION is_valid_chat_reactions(payload JSONB)
        RETURNS BOOLEAN
        LANGUAGE SQL
        IMMUTABLE
        AS $$
          SELECT
            payload IS NOT NULL
            AND jsonb_typeof(payload) = 'object'
            AND jsonb_object_length(payload) <= 20
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_each(payload) AS entry(key, value)
              WHERE length(entry.key) > 8
                OR jsonb_typeof(entry.value) <> 'array'
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(entry.value) AS elem(item)
                  WHERE jsonb_typeof(elem.item) <> 'string'
                    OR length(elem.item #>> '{}') > 64
                )
            )
        $$;
      `);

      await client.query(`
        UPDATE chat_messages
        SET reactions = '{}'::jsonb
        WHERE reactions IS NULL OR NOT is_valid_chat_reactions(reactions)
      `);

      await client.query(`
        ALTER TABLE chat_messages
        DROP CONSTRAINT IF EXISTS chk_chat_messages_reactions_valid
      `);

      await client.query(`
        ALTER TABLE chat_messages
        ADD CONSTRAINT chk_chat_messages_reactions_valid
        CHECK (is_valid_chat_reactions(reactions))
      `);
    },
  },
];
const LATEST_MIGRATION_ID = MIGRATIONS[MIGRATIONS.length - 1]?.id || null;

module.exports = { MIGRATIONS, LATEST_MIGRATION_ID };
