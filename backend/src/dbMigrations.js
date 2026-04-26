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
            AND (
              SELECT count(*)
              FROM jsonb_object_keys(payload)
            ) <= 20
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
  {
    id: '011_multi_tenant_support',
    // Migration 005: Add property_slug to support multi-tenant context
    // This column stores which property this DB belongs to (for logging/debugging)
    async up(client) {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS property_slug VARCHAR(50)`);

      // Push notification subscriptions (Phase 1 prep)
      // user_id — TEXT, чтобы матчить users.uid TEXT (см. CREATE TABLE users
      // выше). Раньше было UUID и FK падал с PG error 42804 на свежих БД.
      await client.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          endpoint TEXT NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          device_name VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(user_id, endpoint)
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`);

      // Announcements (Phase 2 prep)
      await client.query(`
        CREATE TABLE IF NOT EXISTS announcements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          body TEXT NOT NULL,
          type VARCHAR(20) DEFAULT 'info' CHECK (type IN ('info', 'urgent', 'maintenance')),
          pinned BOOLEAN DEFAULT false,
          published_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          author_id TEXT REFERENCES users(uid),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements(pinned, published_at DESC) WHERE pinned = true`);
      // PG требует IMMUTABLE функции в predicate partial index.
      // NOW() — STABLE, ловится ошибкой 42P17. Оставляем только expires_at IS NULL;
      // фильтрацию "не истёк" делаем в WHERE запроса (planner всё равно умеет
      // bitmap-or с idx_announcements_published).
      await client.query(`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(published_at DESC) WHERE expires_at IS NULL`);

      // Documents / Info board (Phase 2 prep)
      await client.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          category VARCHAR(50) DEFAULT 'rules' CHECK (category IN ('rules', 'contacts', 'instructions', 'contracts', 'other')),
          body TEXT,
          file_url TEXT,
          is_public BOOLEAN DEFAULT false,
          sort_order INTEGER DEFAULT 0,
          version INTEGER DEFAULT 1,
          author_id TEXT REFERENCES users(uid),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category, sort_order, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_public ON documents(is_public, sort_order, created_at DESC) WHERE is_public = true`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_author ON documents(author_id, created_at DESC)`);
    },
  },
  {
    id: '012_push_notifications',
    async up(client) {
      // Fix type mismatch: migration 011 declared push_subscriptions.user_id as UUID
      // but users.uid is TEXT. Drop the FK, cast the column, re-add the FK.
      await client.query(`
        ALTER TABLE push_subscriptions
          DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey
      `);
      await client.query(`
        ALTER TABLE push_subscriptions
          ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT
      `);
      await client.query(`
        ALTER TABLE push_subscriptions
          ADD CONSTRAINT push_subscriptions_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(uid) ON DELETE CASCADE
      `);

      // Extend push_subscriptions with Phase 1 columns
      await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform VARCHAR(20) DEFAULT 'web'`);
      await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT`);
      await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
      await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0`);

      // Per-property audit log (all admin mutations write here)
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          actor_uid TEXT REFERENCES users(uid) ON DELETE SET NULL,
          actor_role TEXT,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(50) NOT NULL,
          resource_id TEXT,
          changes JSONB,
          ip_address VARCHAR(45),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_uid, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id, created_at DESC)`);

      // Notification delivery log (retain 90 days per FZ-152)
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT REFERENCES users(uid) ON DELETE SET NULL,
          channel VARCHAR(20) NOT NULL,
          event_type VARCHAR(60) NOT NULL,
          payload JSONB,
          status VARCHAR(20) NOT NULL DEFAULT 'sent',
          error_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notification_log_event ON notification_log(event_type, created_at DESC)`);
    },
  },
  {
    id: '013_request_types_extended',
    async up(client) {
      // Placeholder migration — keeps numbering consistent across deployments.
      // No schema changes needed at this revision.
    },
  },
  {
    id: '014_resident_features',
    async up(client) {
      // ФЗ-152 consent columns
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version VARCHAR(10)`);

      // Move-in/out columns on requests
      await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS freight_elevator_needed BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS parking_spot_reserved TEXT`);

      // Meter readings
      await client.query(`
        CREATE TABLE IF NOT EXISTS meter_readings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          apartment TEXT NOT NULL,
          type VARCHAR(20) NOT NULL CHECK (type IN ('hot_water', 'cold_water', 'electric', 'gas')),
          value NUMERIC(12, 3) NOT NULL,
          unit VARCHAR(10) DEFAULT 'm3',
          photo_url TEXT,
          ocr_raw TEXT,
          ocr_confidence REAL,
          period_year SMALLINT NOT NULL,
          period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
          submitted_at TIMESTAMPTZ DEFAULT NOW(),
          reviewed_by TEXT REFERENCES users(uid),
          reviewed_at TIMESTAMPTZ,
          notes TEXT,
          UNIQUE(user_id, type, period_year, period_month)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_meter_readings_user ON meter_readings(user_id, period_year DESC, period_month DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_meter_readings_apt ON meter_readings(apartment, period_year DESC, period_month DESC)`);

      // Billing records
      await client.query(`
        CREATE TABLE IF NOT EXISTS billing_records (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          apartment TEXT NOT NULL,
          period_year SMALLINT NOT NULL,
          period_month SMALLINT NOT NULL,
          description TEXT,
          amount NUMERIC(12, 2) NOT NULL,
          currency VARCHAR(3) DEFAULT 'RUB',
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
          due_date DATE,
          paid_at TIMESTAMPTZ,
          payment_link TEXT,
          invoice_url TEXT,
          external_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_records(user_id, period_year DESC, period_month DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_billing_apt ON billing_records(apartment, status, due_date)`);

      // btree_gist — needed for space booking overlap exclusion constraints.
      // May fail if superuser privileges are unavailable; overlap is also enforced
      // at the application level, so this is best-effort.
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
      } catch (_err) {
        // Non-fatal: app-level overlap check handles this case.
      }

      // Spaces
      await client.query(`
        CREATE TABLE IF NOT EXISTS spaces (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          description TEXT,
          type VARCHAR(30) NOT NULL CHECK (type IN ('party_room','sauna','gym','bbq','roof','conference','other')),
          capacity INTEGER,
          price_per_slot NUMERIC(10,2) DEFAULT 0,
          slot_duration_minutes INTEGER DEFAULT 60,
          open_time TIME DEFAULT '08:00',
          close_time TIME DEFAULT '22:00',
          advance_days INTEGER DEFAULT 14,
          max_concurrent_bookings INTEGER DEFAULT 1,
          is_active BOOLEAN DEFAULT true,
          photo_url TEXT,
          rules TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Space bookings
      await client.query(`
        CREATE TABLE IF NOT EXISTS space_bookings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
          starts_at TIMESTAMPTZ NOT NULL,
          ends_at TIMESTAMPTZ NOT NULL,
          status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','pending_approval')),
          attendees_count INTEGER DEFAULT 1,
          notes TEXT,
          cancelled_reason TEXT,
          cancelled_at TIMESTAMPTZ,
          cancelled_by TEXT REFERENCES users(uid),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_bookings_space_time
        ON space_bookings(space_id, starts_at, ends_at)
        WHERE status != 'cancelled'
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_user ON space_bookings(user_id, starts_at DESC)`);
    },
  },
  {
    id: '015_announcements_qr_pass',
    async up(client) {
      // Add notes column to visit_logs for guard deny reasons
      await client.query(`ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS notes TEXT`);

      // Extend announcements table (created in 011)
      await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT`);
      await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_label VARCHAR(100)`);
      await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_url TEXT`);
      await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

      // Extend documents table (created in 011)
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_documents_active
        ON documents(category, sort_order)
        WHERE deleted_at IS NULL
      `);

      // QR passes for approved requests
      await client.query(`
        CREATE TABLE IF NOT EXISTS qr_passes (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          request_id         TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          token              TEXT NOT NULL UNIQUE,
          created_at         TIMESTAMPTZ DEFAULT NOW(),
          expires_at         TIMESTAMPTZ NOT NULL,
          used_at            TIMESTAMPTZ,
          used_by_uid        TEXT REFERENCES users(uid),
          invalidated_at     TIMESTAMPTZ,
          invalidated_reason TEXT
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_qr_passes_token
        ON qr_passes(token)
        WHERE invalidated_at IS NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_qr_passes_request
        ON qr_passes(request_id)
      `);
    },
  },
  {
    id: '016_concierge_packages',
    async up(client) {
      // SLA config per request type
      await client.query(`
        CREATE TABLE IF NOT EXISTS request_sla_config (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          request_type VARCHAR(30) NOT NULL UNIQUE,
          sla_hours INTEGER NOT NULL DEFAULT 24,
          escalation_hours INTEGER,
          is_active BOOLEAN DEFAULT true
        )
      `);
      await client.query(`
        INSERT INTO request_sla_config (request_type, sla_hours, escalation_hours) VALUES
          ('repair', 24, 48), ('cleaning', 4, 8), ('concierge', 2, 4),
          ('complaint', 48, 72), ('suggestion', 72, NULL),
          ('pass', 1, 2), ('car', 1, 2), ('tech', 8, 24),
          ('move_in', 4, 8), ('move_out', 4, 8)
        ON CONFLICT (request_type) DO NOTHING
      `);

      // Post-completion rating columns on requests
      await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`);
      await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS rating_comment TEXT`);
      await client.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ`);

      // Packages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS packages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          recipient_user_id TEXT REFERENCES users(uid) ON DELETE SET NULL,
          recipient_apartment TEXT NOT NULL,
          recipient_name TEXT NOT NULL,
          sender_name TEXT,
          tracking_number TEXT,
          carrier VARCHAR(50),
          photo_url TEXT,
          received_at TIMESTAMPTZ DEFAULT NOW(),
          received_by TEXT NOT NULL REFERENCES users(uid),
          picked_up_at TIMESTAMPTZ,
          picked_up_by_name TEXT,
          notified_at TIMESTAMPTZ,
          reminder_sent_at TIMESTAMPTZ,
          status VARCHAR(20) DEFAULT 'awaiting_pickup'
            CHECK (status IN ('awaiting_pickup','picked_up','returned')),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_packages_recipient ON packages(recipient_user_id, status, received_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_packages_apt ON packages(recipient_apartment, status)`);
    },
  },
  {
    id: '017_webhooks_integrations',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          url TEXT NOT NULL,
          secret TEXT NOT NULL,
          events TEXT[] NOT NULL,
          is_active BOOLEAN DEFAULT true,
          retry_count INTEGER DEFAULT 0,
          last_attempt_at TIMESTAMPTZ,
          last_success_at TIMESTAMPTZ,
          last_error TEXT,
          created_by TEXT REFERENCES users(uid),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type VARCHAR(60) NOT NULL,
          payload JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          attempt_count INTEGER DEFAULT 0,
          next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
          response_status INTEGER,
          response_body TEXT,
          error_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
          ON webhook_deliveries(next_attempt_at) WHERE status IN ('pending','retrying')
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
          ON webhook_deliveries(webhook_id, created_at DESC)
      `);

      await client.query(`ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS clip_url TEXT`);
    },
  },
  {
    // ФЗ-152 runtime: consent tracking, GDPR/right-to-be-forgotten requests,
    // photo retention support.  See docs/product/specs/domhub-final-product-plan.md.
    id: '018_fz152_privacy',
    async up(client) {
      // Consent tracking on users table
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS consent_version    TEXT,
          ADD COLUMN IF NOT EXISTS anonymized_at      TIMESTAMPTZ
      `);

      // Audit log of data-deletion/erasure requests.  We keep the audit row even
      // after the user record is anonymized, so regulators can inspect that the
      // operation was carried out.
      await client.query(`
        CREATE TABLE IF NOT EXISTS privacy_deletion_requests (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          uid           TEXT NOT NULL,
          phone_hash    TEXT,
          requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at  TIMESTAMPTZ,
          status        TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','completed','failed')),
          reason        TEXT,
          note          TEXT
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_privacy_deletion_requests_uid
          ON privacy_deletion_requests(uid, requested_at DESC)
      `);

      // Expose created_at as an index on upload_objects for the retention sweep.
      // We match the existing idx_upload_objects_owner signature but drop the
      // owner prefix — the retention job scans by created_at alone.
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_upload_objects_created_at
          ON upload_objects(created_at)
      `);
    },
  },
];
const LATEST_MIGRATION_ID = MIGRATIONS[MIGRATIONS.length - 1]?.id || null;

module.exports = { MIGRATIONS, LATEST_MIGRATION_ID };
