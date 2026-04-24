'use strict';

// platform-v1 property-DB migration 021 — property_audit_log (Фаза 5).
// Spec-file: отсутствует намеренно — rename + extend описан в
// docs/product/specs/platform-v1/README.md §"Фаза 5 не покрытая спеками".
//
// Суть:
//   1. legacy `audit_log` → `property_audit_log` (переименование таблицы
//      и индексов, если легаси существует и новый не создан)
//   2. добавляются 4 колонки для split-users модели platform-v1:
//      property_id, actor_type, entity_type, entity_id
//   3. legacy `actor_uid TEXT REFERENCES users(uid)` сохраняется как есть
//      для исторических записей; новые записи пишут actor_type + любой из
//      (actor_uid | entity_id resolves to resident/staff/contractor)
//
// Почему это делается миграцией, а не отдельной spec-семьёй:
//   - нет новой бизнес-логики, только columnар-расширение
//   - service-слой audit-log не ломается, добавляет опциональные поля
//   - spec на сам audit-flow пишется в следующей фазе (DOCS-5 BACKLOG)
//
// Идемпотентность на трёх состояниях кластера:
//   - fresh install (нет audit_log): CREATE TABLE IF NOT EXISTS срабатывает
//   - pre-v1 tenant (есть audit_log, нет property_audit_log): RENAME + ALTER
//   - уже мигрирован: все statement'ы no-op

module.exports = {
  id: 'v1_021_property_audit_log',
  async up(client) {
    // 1. Conditional rename legacy → property_audit_log + rename indexes.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name   = 'audit_log'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name   = 'property_audit_log'
        ) THEN
          EXECUTE 'ALTER TABLE audit_log RENAME TO property_audit_log';
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE indexname = 'idx_audit_log_actor'
             AND schemaname = current_schema()
        ) THEN
          EXECUTE 'ALTER INDEX idx_audit_log_actor RENAME TO idx_property_audit_log_actor';
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE indexname = 'idx_audit_log_resource'
             AND schemaname = current_schema()
        ) THEN
          EXECUTE 'ALTER INDEX idx_audit_log_resource RENAME TO idx_property_audit_log_resource';
        END IF;
      END
      $$
    `);

    // 2. Fresh-install fallback (если legacy audit_log не существовал).
    // Примечание: actor_uid здесь БЕЗ FK на users — platform-v1 уже не
    // знает о таблице users (split уже произошёл).  Legacy tenants
    // сохраняют свой FK (он пришёл по наследству через RENAME).
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_audit_log (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_uid      TEXT,
        actor_role     TEXT,
        action         VARCHAR(100) NOT NULL,
        resource_type  VARCHAR(50) NOT NULL,
        resource_id    TEXT,
        changes        JSONB,
        ip_address     VARCHAR(45),
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 3. v1 extension columns (idempotent).
    await client.query(`
      ALTER TABLE property_audit_log
        ADD COLUMN IF NOT EXISTS property_id UUID
    `);
    await client.query(`
      ALTER TABLE property_audit_log
        ADD COLUMN IF NOT EXISTS actor_type  VARCHAR(20)
    `);
    await client.query(`
      ALTER TABLE property_audit_log
        ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)
    `);
    await client.query(`
      ALTER TABLE property_audit_log
        ADD COLUMN IF NOT EXISTS entity_id   UUID
    `);

    // 4. actor_type CHECK (drop-then-add для идемпотентности).
    await client.query(`
      ALTER TABLE property_audit_log
        DROP CONSTRAINT IF EXISTS property_audit_log_actor_type_check
    `);
    await client.query(`
      ALTER TABLE property_audit_log
        ADD CONSTRAINT property_audit_log_actor_type_check CHECK (
          actor_type IS NULL
          OR actor_type IN ('resident','staff','contractor','system','external')
        )
    `);

    // 5. Indexes (legacy + new).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_audit_log_actor
        ON property_audit_log(actor_uid, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_audit_log_resource
        ON property_audit_log(resource_type, resource_id, created_at DESC)
    `);

    // v1 entity lookup — новые записи адресуются через entity_type/entity_id.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_audit_log_entity
        ON property_audit_log(entity_type, entity_id, created_at DESC)
        WHERE entity_id IS NOT NULL
    `);

    // Per-property timeline (partial на всё что НЕ legacy-null property_id).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_audit_log_property_time
        ON property_audit_log(property_id, created_at DESC)
        WHERE property_id IS NOT NULL
    `);
  },
};
