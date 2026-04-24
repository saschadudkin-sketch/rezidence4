'use strict';

// platform-v1 property-DB migration 020 — announcements_v2 (Фаза 5).
// Spec: docs/product/specs/platform-v1/announcements-v2-spec.md §2.
//
// Объявления УК резидентам объекта с time-bound видимостью
// (starts_at/expires_at) и audience-targeting (all/building/entrance/
// unit_type).  В отличие от documents_v2 — событийная сущность: publish
// триггерит fan-out в notifications_outbox (см. spec §5).
//
// Ключевые отличия от legacy `announcements`:
//   - property_id (legacy single-tenant)
//   - is_urgent BOOL + category ENUM (legacy был один type-enum, путались
//     категория и срочность)
//   - starts_at NOT NULL (legacy не имел отложенной публикации)
//   - audience_type + audience_building_id/entrance_id/unit_type
//     (legacy broadcast всем)
//   - notify_channels TEXT[] (какие каналы использовать в fan-out)
//   - created_by_staff_id/published_by_staff_id (legacy author_id TEXT)
//
// audience_type='custom' зарезервирован в enum, но в CHECK'е НЕТ —
// соответствующая таблица announcement_targets не создаётся в v1 (§7 Q3).
// Добавление — отдельной миграцией при появлении feature.
//
// Инварианты §2.1:
//   expires_at > starts_at (если задан)
//   audience_type соответствует заполнению audience_* полей
//   published_at NOT NULL ⇒ published_by_staff_id NOT NULL
//   is_urgent=true ⇒ 'web_push' ∈ notify_channels (SMS без push недопустим)
//   notify_channels ⊆ {web_push, sms, telegram, email}
//   deleted_at IS NULL OR deleted_at >= created_at

module.exports = {
  id: 'v1_020_announcements_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements_v2 (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        title                  TEXT NOT NULL,
        body_md                TEXT NOT NULL,
        is_urgent              BOOLEAN NOT NULL DEFAULT false,
        category               VARCHAR(20) NOT NULL DEFAULT 'general'
                                 CHECK (category IN (
                                   'general','maintenance','event',
                                   'emergency','marketing'
                                 )),
        audience_type          VARCHAR(20) NOT NULL DEFAULT 'all'
                                 CHECK (audience_type IN (
                                   'all','building','entrance','unit_type'
                                 )),
        audience_building_id   UUID REFERENCES buildings(id) ON DELETE RESTRICT,
        audience_entrance_id   UUID REFERENCES entrances(id) ON DELETE RESTRICT,
        audience_unit_type     VARCHAR(20)
                                 CHECK (audience_unit_type IS NULL
                                        OR audience_unit_type IN (
                                          'owner','tenant','family_member'
                                        )),
        starts_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at             TIMESTAMPTZ,
        is_pinned              BOOLEAN NOT NULL DEFAULT false,
        notify_channels        TEXT[] NOT NULL DEFAULT ARRAY['web_push']::text[],
        published_at           TIMESTAMPTZ,
        created_by_staff_id    UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        published_by_staff_id  UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at             TIMESTAMPTZ,
        CONSTRAINT announcements_v2_window CHECK (
          expires_at IS NULL OR expires_at > starts_at
        ),
        CONSTRAINT announcements_v2_audience_fields CHECK (
          (audience_type = 'all'
            AND audience_building_id IS NULL
            AND audience_entrance_id IS NULL
            AND audience_unit_type   IS NULL)
          OR (audience_type = 'building'
            AND audience_building_id IS NOT NULL
            AND audience_entrance_id IS NULL
            AND audience_unit_type   IS NULL)
          OR (audience_type = 'entrance'
            AND audience_building_id IS NULL
            AND audience_entrance_id IS NOT NULL
            AND audience_unit_type   IS NULL)
          OR (audience_type = 'unit_type'
            AND audience_building_id IS NULL
            AND audience_entrance_id IS NULL
            AND audience_unit_type   IS NOT NULL)
        ),
        CONSTRAINT announcements_v2_publish_audit CHECK (
          published_at IS NULL OR published_by_staff_id IS NOT NULL
        ),
        CONSTRAINT announcements_v2_urgent_requires_push CHECK (
          NOT is_urgent OR 'web_push' = ANY(notify_channels)
        ),
        CONSTRAINT announcements_v2_delete_audit CHECK (
          deleted_at IS NULL OR deleted_at >= created_at
        ),
        CONSTRAINT announcements_v2_channels_subset CHECK (
          notify_channels <@ ARRAY['web_push','sms','telegram','email']::text[]
        )
      )
    `);

    // Основной feed для резидента: pinned DESC → urgent DESC → newest.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_v2_feed
        ON announcements_v2(property_id, is_pinned DESC, is_urgent DESC, starts_at DESC)
        WHERE deleted_at IS NULL AND published_at IS NOT NULL
    `);

    // Category filter.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_v2_category
        ON announcements_v2(property_id, category, starts_at DESC)
        WHERE deleted_at IS NULL
    `);

    // Admin view (by publish time).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_v2_admin
        ON announcements_v2(property_id, published_at DESC)
        WHERE published_at IS NOT NULL
    `);

    // Audience lookup при cron fan-out.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_v2_audience_building
        ON announcements_v2(property_id, audience_building_id)
        WHERE audience_building_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_v2_audience_entrance
        ON announcements_v2(property_id, audience_entrance_id)
        WHERE audience_entrance_id IS NOT NULL
    `);
  },
};
