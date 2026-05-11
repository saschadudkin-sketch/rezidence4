'use strict';

// platform-v1 property-DB migration 034 — SKUD adapter framework baseline.
//
// DH-41 introduces tenant-scoped provider configuration, hardware mapping and
// persisted integration events. Vendor-specific behavior remains in adapters;
// these tables keep the runtime model vendor-neutral.

module.exports = {
  id: 'v1_034_skud_adapter_framework',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS skud_provider_configs (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id       UUID NOT NULL,
        provider          VARCHAR(40) NOT NULL
                         CHECK (provider IN (
                           'hikvision','bolid','sigur','parsec','generic'
                         )),
        display_name      VARCHAR(120) NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','disabled','degraded')),
        sync_mode         VARCHAR(20) NOT NULL DEFAULT 'hybrid'
                         CHECK (sync_mode IN ('push','pull','hybrid','manual')),
        base_url          TEXT,
        auth_ref          TEXT,
        config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities      JSONB NOT NULL DEFAULT '[]'::jsonb,
        health_status     VARCHAR(20) NOT NULL DEFAULT 'unknown'
                         CHECK (health_status IN ('unknown','healthy','degraded','down')),
        last_success_at   TIMESTAMPTZ,
        last_failure_at   TIMESTAMPTZ,
        last_error        TEXT,
        created_by        UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT skud_provider_configs_property_id_unique UNIQUE (property_id, id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_provider_configs_property
        ON skud_provider_configs(property_id, status, provider)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_skud_provider_configs_property_name_active
        ON skud_provider_configs(property_id, provider, LOWER(display_name))
        WHERE status <> 'disabled'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS skud_hardware_devices (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        provider_config_id     UUID NOT NULL,
        access_point_id        UUID,
        device_class           VARCHAR(30) NOT NULL
                               CHECK (device_class IN (
                                 'controller','reader','barrier','gate','door',
                                 'turnstile','wicket','intercom','lpr','camera'
                               )),
        name                  VARCHAR(120) NOT NULL,
        external_device_id    TEXT NOT NULL,
        source_of_truth       VARCHAR(20) NOT NULL
                              CHECK (source_of_truth IN ('domhub','provider','manual')),
        fallback_rule         VARCHAR(30) NOT NULL
                              CHECK (fallback_rule IN (
                                'manual_guard','manual_open','provider_readonly',
                                'offline_queue','deny_until_restored'
                              )),
        direction             VARCHAR(20) NOT NULL DEFAULT 'bidirectional'
                              CHECK (direction IN ('entry','exit','bidirectional')),
        status                VARCHAR(20) NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','disabled','degraded')),
        metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_seen_at          TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT skud_hardware_devices_provider_property_fk
          FOREIGN KEY (property_id, provider_config_id)
          REFERENCES skud_provider_configs(property_id, id)
          ON DELETE CASCADE,
        CONSTRAINT skud_hardware_devices_property_id_unique UNIQUE (property_id, id),
        CONSTRAINT skud_hardware_devices_access_point_property_fk
          FOREIGN KEY (property_id, access_point_id)
          REFERENCES access_points(property_id, id)
          ON DELETE SET NULL
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_skud_hardware_devices_external
        ON skud_hardware_devices(property_id, provider_config_id, external_device_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_hardware_devices_access_point
        ON skud_hardware_devices(property_id, access_point_id, status)
        WHERE access_point_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_hardware_devices_class
        ON skud_hardware_devices(property_id, device_class, status)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS skud_integration_events (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        provider_config_id     UUID NOT NULL,
        hardware_device_id     UUID,
        access_point_id        UUID,
        direction              VARCHAR(20) NOT NULL
                               CHECK (direction IN ('inbound','outbound')),
        event_type             VARCHAR(60) NOT NULL,
        external_event_id      TEXT,
        status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending','processing','succeeded','failed',
                                 'retrying','dead_lettered','ignored'
                               )),
        domhub_entity_type     VARCHAR(40),
        domhub_entity_id       TEXT,
        payload                JSONB NOT NULL DEFAULT '{}'::jsonb,
        normalized_payload     JSONB,
        error_code             TEXT,
        error_message          TEXT,
        attempts               INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        occurred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at           TIMESTAMPTZ,
        next_retry_at          TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT skud_integration_events_provider_property_fk
          FOREIGN KEY (property_id, provider_config_id)
          REFERENCES skud_provider_configs(property_id, id)
          ON DELETE CASCADE,
        CONSTRAINT skud_integration_events_device_property_fk
          FOREIGN KEY (property_id, hardware_device_id)
          REFERENCES skud_hardware_devices(property_id, id)
          ON DELETE SET NULL,
        CONSTRAINT skud_integration_events_access_point_property_fk
          FOREIGN KEY (property_id, access_point_id)
          REFERENCES access_points(property_id, id)
          ON DELETE SET NULL
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_skud_integration_events_external
        ON skud_integration_events(property_id, provider_config_id, external_event_id)
        WHERE external_event_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_integration_events_status
        ON skud_integration_events(property_id, status, next_retry_at, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_integration_events_point_time
        ON skud_integration_events(property_id, access_point_id, occurred_at DESC)
        WHERE access_point_id IS NOT NULL
    `);
  },
};
