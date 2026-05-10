'use strict';

// platform-v1 property-DB migration 036 — VMS/NVR provider configs.
//
// DH-43 follow-up: keep video link-only, but model Russian-market VMS/NVR
// systems separately from SKUD configs so cameras can point at a recorder/VMS
// without overloading access-control provider metadata.

module.exports = {
  id: 'v1_036_video_provider_configs',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS video_provider_configs (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        provider            VARCHAR(40) NOT NULL
                            CHECK (provider IN (
                              'trassir','macroscop','hikvision_nvr',
                              'dahua_nvr','axxon_next','devline_line',
                              'generic_link'
                            )),
        display_name        VARCHAR(120) NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','disabled','degraded')),
        base_url            TEXT,
        auth_ref            TEXT,
        config_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities        JSONB NOT NULL DEFAULT '[]'::jsonb,
        health_status       VARCHAR(20) NOT NULL DEFAULT 'unknown'
                            CHECK (health_status IN ('unknown','healthy','degraded','down')),
        last_success_at     TIMESTAMPTZ,
        last_failure_at     TIMESTAMPTZ,
        last_error          TEXT,
        created_by          UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT video_provider_configs_property_id_unique UNIQUE (property_id, id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_provider_configs_property
        ON video_provider_configs(property_id, status, provider)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_video_provider_configs_property_name_active
        ON video_provider_configs(property_id, LOWER(display_name))
        WHERE status <> 'disabled'
    `);

    await client.query(`
      ALTER TABLE skud_hardware_devices
        ADD COLUMN IF NOT EXISTS video_provider_config_id UUID
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'skud_hardware_devices_video_provider_property_fk'
        ) THEN
          ALTER TABLE skud_hardware_devices
            ADD CONSTRAINT skud_hardware_devices_video_provider_property_fk
              FOREIGN KEY (property_id, video_provider_config_id)
              REFERENCES video_provider_configs(property_id, id)
              ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_hardware_devices_video_provider
        ON skud_hardware_devices(property_id, video_provider_config_id, access_point_id)
        WHERE video_provider_config_id IS NOT NULL
    `);

    await client.query(`
      ALTER TABLE video_evidence_references
        ADD COLUMN IF NOT EXISTS video_provider_config_id UUID
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'video_evidence_video_provider_fk'
        ) THEN
          ALTER TABLE video_evidence_references
            ADD CONSTRAINT video_evidence_video_provider_fk
              FOREIGN KEY (video_provider_config_id)
              REFERENCES video_provider_configs(id)
              ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_evidence_video_provider
        ON video_evidence_references(property_id, video_provider_config_id, created_at DESC)
        WHERE video_provider_config_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_video_evidence_video_provider_event
        ON video_evidence_references(property_id, video_provider_config_id, video_provider_event_id)
        WHERE video_provider_config_id IS NOT NULL AND video_provider_event_id IS NOT NULL
    `);
  },
};
