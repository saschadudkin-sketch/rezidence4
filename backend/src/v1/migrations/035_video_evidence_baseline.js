'use strict';

// platform-v1 property-DB migration 035 — video evidence reference baseline.
//
// DH-43 keeps DomHub out of the native VMS business: we store camera context,
// clip/snapshot/provider references and auditable links to access incidents or
// access events. Biometric identity matching is explicitly disallowed here.

module.exports = {
  id: 'v1_035_video_evidence_baseline',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS video_evidence_references (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                 UUID NOT NULL,
        access_incident_id          UUID REFERENCES access_incidents(id) ON DELETE CASCADE,
        visit_log_id                UUID REFERENCES visit_logs_v2(id) ON DELETE SET NULL,
        skud_integration_event_id   UUID REFERENCES skud_integration_events(id) ON DELETE SET NULL,
        camera_device_id            UUID REFERENCES skud_hardware_devices(id) ON DELETE SET NULL,
        provider_config_id          UUID REFERENCES skud_provider_configs(id) ON DELETE SET NULL,
        evidence_type               VARCHAR(30) NOT NULL
                                    CHECK (evidence_type IN (
                                      'clip','snapshot','event_reference',
                                      'camera_context','unavailable'
                                    )),
        source                      VARCHAR(20) NOT NULL DEFAULT 'manual'
                                    CHECK (source IN ('manual','provider','webhook','system')),
        status                      VARCHAR(20) NOT NULL DEFAULT 'linked'
                                    CHECK (status IN ('linked','unavailable','expired','removed')),
        title                       VARCHAR(160),
        clip_url                    TEXT,
        snapshot_url                TEXT,
        external_ref                TEXT,
        video_provider_event_id     TEXT,
        video_timestamp_from        TIMESTAMPTZ,
        video_timestamp_to          TIMESTAMPTZ,
        sensitivity                 VARCHAR(20) NOT NULL DEFAULT 'restricted'
                                    CHECK (sensitivity IN ('restricted','sensitive')),
        metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
        biometric_identity_matching BOOLEAN NOT NULL DEFAULT FALSE
                                    CHECK (biometric_identity_matching = FALSE),
        created_by_staff_id         UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT video_evidence_has_target CHECK (
          access_incident_id IS NOT NULL
          OR visit_log_id IS NOT NULL
          OR skud_integration_event_id IS NOT NULL
        ),
        CONSTRAINT video_evidence_has_reference CHECK (
          status = 'unavailable'
          OR clip_url IS NOT NULL
          OR snapshot_url IS NOT NULL
          OR external_ref IS NOT NULL
          OR video_provider_event_id IS NOT NULL
          OR camera_device_id IS NOT NULL
        ),
        CONSTRAINT video_evidence_time_window CHECK (
          video_timestamp_from IS NULL
          OR video_timestamp_to IS NULL
          OR video_timestamp_to >= video_timestamp_from
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_evidence_incident
        ON video_evidence_references(property_id, access_incident_id, created_at DESC)
        WHERE access_incident_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_evidence_visit
        ON video_evidence_references(property_id, visit_log_id, created_at DESC)
        WHERE visit_log_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_evidence_camera_time
        ON video_evidence_references(property_id, camera_device_id, video_timestamp_from DESC)
        WHERE camera_device_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_video_evidence_provider_event
        ON video_evidence_references(property_id, provider_config_id, video_provider_event_id)
        WHERE provider_config_id IS NOT NULL AND video_provider_event_id IS NOT NULL
    `);
  },
};
