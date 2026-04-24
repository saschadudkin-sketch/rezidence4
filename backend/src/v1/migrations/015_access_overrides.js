'use strict';

// platform-v1 property-DB migration 015 — access_overrides (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/access-incidents-spec.md §2.
//
// Append-only журнал решений staff в обход автоматической политики:
// manual_admit/deny (пропустил руками), temporary_whitelist/temporary_block
// (временный флаг на vehicle/pass).  Не имеет status — каждая строка
// терминальна.
//
// CHECK «incident_id OR pass_id» — override должен к чему-то относиться.
// Standalone-manual_admit резидента без привязки создаётся через парное
// создание incident(manual_override, status='resolved') + override
// (см. access-incidents-spec §7.6).

module.exports = {
  id: 'v1_015_access_overrides',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_overrides (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id             UUID NOT NULL,
        incident_id             UUID REFERENCES access_incidents(id) ON DELETE SET NULL,
        pass_id                 UUID REFERENCES passes(id) ON DELETE SET NULL,
        performed_by_staff_id   UUID NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
        override_type           VARCHAR(20) NOT NULL
                                CHECK (override_type IN (
                                  'manual_admit','manual_deny',
                                  'temporary_whitelist','temporary_block'
                                )),
        reason                  TEXT NOT NULL,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT access_overrides_target_required CHECK (
          incident_id IS NOT NULL OR pass_id IS NOT NULL
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_overrides_incident
        ON access_overrides(incident_id) WHERE incident_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_overrides_pass
        ON access_overrides(pass_id) WHERE pass_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_overrides_staff_time
        ON access_overrides(performed_by_staff_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_overrides_property_time
        ON access_overrides(property_id, created_at DESC)
    `);
  },
};
