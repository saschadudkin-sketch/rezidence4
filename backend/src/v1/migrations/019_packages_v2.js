'use strict';

// platform-v1 property-DB migration 019 — packages_v2 (Фаза 5).
// Spec: docs/product/specs/platform-v1/packages-v2-spec.md §2.
//
// Журнал посылок, принимаемых ресепшн от имени резидента.  State machine:
//   awaiting_pickup → {picked_up, returned, lost}   (все терминальны)
//
// Ключевые изменения vs legacy `packages`:
//   - property_id (legacy single-tenant)
//   - unit_id NOT NULL (legacy recipient_apartment TEXT + user_id параллельно)
//   - recipient_resident_id NULL (явная адресация; если NULL — любой active
//     резидент unit'а может забрать — §8 Q6)
//   - received_by_staff_id / picked_up_by_staff_id / picked_up_by_resident_id
//     FK вместо TEXT uid'ов (после split users)
//   - notified_at/reminder_sent_at УДАЛЕНЫ — факт отправки в outbox+log_v2
//   - status расширен: добавлен 'lost' (legacy только 3 значения)
//
// Инварианты §2:
//   picked_up  ⇒ picked_up_at + picked_up_by_staff_id NOT NULL
//   returned   ⇒ returned_at NOT NULL
//   awaiting   ⇒ picked_up_at + returned_at IS NULL
//   picked_up: либо picked_up_by_resident_id, либо picked_up_by_name
//             (не оба; при picked_up один из двух обязателен)

module.exports = {
  id: 'v1_019_packages_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS packages_v2 (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                UUID NOT NULL,
        unit_id                    UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        recipient_resident_id      UUID REFERENCES residents(id) ON DELETE SET NULL,
        recipient_name_snapshot    TEXT,
        sender_name                TEXT,
        carrier                    VARCHAR(50),
        tracking_number            VARCHAR(80),
        photo_url                  TEXT,
        size_category              VARCHAR(20)
                                     CHECK (size_category IS NULL
                                            OR size_category IN (
                                              'envelope','small','medium','large','oversize'
                                            )),
        received_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        received_by_staff_id       UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
        storage_location           VARCHAR(40),
        status                     VARCHAR(20) NOT NULL DEFAULT 'awaiting_pickup'
                                     CHECK (status IN (
                                       'awaiting_pickup','picked_up','returned','lost'
                                     )),
        picked_up_at               TIMESTAMPTZ,
        picked_up_by_resident_id   UUID REFERENCES residents(id) ON DELETE SET NULL,
        picked_up_by_name          TEXT,
        picked_up_by_staff_id      UUID REFERENCES staff_users(id) ON DELETE RESTRICT,
        returned_at                TIMESTAMPTZ,
        returned_reason            TEXT,
        notes                      TEXT,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT packages_v2_pickup_audit CHECK (
          status <> 'picked_up'
          OR (picked_up_at IS NOT NULL AND picked_up_by_staff_id IS NOT NULL)
        ),
        CONSTRAINT packages_v2_return_audit CHECK (
          status <> 'returned' OR returned_at IS NOT NULL
        ),
        CONSTRAINT packages_v2_awaiting_clean CHECK (
          status <> 'awaiting_pickup'
          OR (picked_up_at IS NULL AND returned_at IS NULL)
        ),
        CONSTRAINT packages_v2_pickup_identity_exclusive CHECK (
          picked_up_by_resident_id IS NULL OR picked_up_by_name IS NULL
        ),
        CONSTRAINT packages_v2_pickup_identity_required CHECK (
          status <> 'picked_up'
          OR picked_up_by_resident_id IS NOT NULL
          OR picked_up_by_name IS NOT NULL
        )
      )
    `);

    // Главный list «что ждёт выдачи» (per-tenant, status, newest first).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_packages_v2_property_status_time
        ON packages_v2(property_id, status, received_at DESC)
    `);

    // «Что на эту квартиру» per-unit view.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_packages_v2_unit_status
        ON packages_v2(property_id, unit_id, status)
    `);

    // /packages/mine для резидента.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_packages_v2_recipient_status
        ON packages_v2(property_id, recipient_resident_id, status)
        WHERE recipient_resident_id IS NOT NULL
    `);

    // SLA scheduled job hot path: find awaiting_pickup rows by age.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_packages_v2_sla
        ON packages_v2(property_id, received_at DESC)
        WHERE status = 'awaiting_pickup'
    `);

    // «Это моя посылка?» lookup по tracking_number при конфликте.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_packages_v2_tracking
        ON packages_v2(property_id, tracking_number)
        WHERE tracking_number IS NOT NULL
    `);
  },
};
