'use strict';

// platform-v1 property-DB migration 038 — ERP/1C exchange baseline.
//
// DH-44 introduces a neutral operational exchange layer for 1C/ERP/ZhKH-style
// systems. DomHub remains the access/operations system of record: these tables
// stage imports, keep explicit external-ID mappings and record export jobs.

module.exports = {
  id: 'v1_038_erp_exchange_baseline',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS erp_provider_configs (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        provider            VARCHAR(40) NOT NULL
                            CHECK (provider IN (
                              'one_c','one_c_zhkh','housing_erp',
                              'generic_csv','generic_rest','generic_webhook'
                            )),
        display_name        VARCHAR(120) NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','disabled','degraded')),
        sync_mode           VARCHAR(20) NOT NULL DEFAULT 'import_only'
                            CHECK (sync_mode IN ('import_only','export_only','hybrid','manual')),
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

        CONSTRAINT erp_provider_configs_property_id_unique UNIQUE (property_id, id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_provider_configs_property
        ON erp_provider_configs(property_id, status, provider)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_provider_configs_property_name_active
        ON erp_provider_configs(property_id, provider, LOWER(display_name))
        WHERE status <> 'disabled'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS erp_external_mappings (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        provider_config_id     UUID NOT NULL,
        external_entity_type   VARCHAR(40) NOT NULL
                               CHECK (external_entity_type IN (
                                 'property','building','entrance','unit',
                                 'resident','staff_user','contractor_company',
                                 'contractor_user','vehicle','account'
                               )),
        external_id            TEXT NOT NULL,
        domhub_entity_type     VARCHAR(40)
                               CHECK (
                                 domhub_entity_type IS NULL OR domhub_entity_type IN (
                                   'property','building','entrance','unit',
                                   'resident','staff_user','contractor_company',
                                   'contractor_user','vehicle'
                                 )
                               ),
        domhub_entity_id       UUID,
        external_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
        conflict_status        VARCHAR(20) NOT NULL DEFAULT 'unmapped'
                               CHECK (conflict_status IN ('mapped','unmapped','conflict','ignored')),
        last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT erp_external_mappings_provider_property_fk
          FOREIGN KEY (property_id, provider_config_id)
          REFERENCES erp_provider_configs(property_id, id)
          ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_external_mappings_external
        ON erp_external_mappings(property_id, provider_config_id, external_entity_type, external_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_external_mappings_domhub
        ON erp_external_mappings(property_id, domhub_entity_type, domhub_entity_id)
        WHERE domhub_entity_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_external_mappings_conflicts
        ON erp_external_mappings(property_id, conflict_status, updated_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS erp_sync_jobs (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        provider_config_id     UUID NOT NULL,
        direction              VARCHAR(20) NOT NULL
                               CHECK (direction IN ('import','export')),
        dataset                VARCHAR(50) NOT NULL
                               CHECK (dataset IN (
                                 'property_structure','resident_registry',
                                 'staff_registry','contractor_registry',
                                 'vehicle_registry','access_events_summary',
                                 'incident_summary','request_summary'
                               )),
        source                 VARCHAR(20) NOT NULL DEFAULT 'manual'
                               CHECK (source IN ('csv','rest','webhook','manual')),
        mode                   VARCHAR(20) NOT NULL DEFAULT 'dry_run'
                               CHECK (mode IN ('dry_run','apply')),
        status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending','processing','completed','failed',
                                 'partial','dead_lettered'
                               )),
        summary                JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message          TEXT,
        created_by            UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        started_at            TIMESTAMPTZ,
        completed_at          TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT erp_sync_jobs_provider_property_fk
          FOREIGN KEY (property_id, provider_config_id)
          REFERENCES erp_provider_configs(property_id, id)
          ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_jobs_provider_time
        ON erp_sync_jobs(property_id, provider_config_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_jobs_status
        ON erp_sync_jobs(property_id, status, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS erp_sync_records (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        sync_job_id            UUID NOT NULL REFERENCES erp_sync_jobs(id) ON DELETE CASCADE,
        provider_config_id     UUID NOT NULL,
        row_index              INTEGER NOT NULL CHECK (row_index >= 0),
        external_entity_type   VARCHAR(40) NOT NULL
                               CHECK (external_entity_type IN (
                                 'property','building','entrance','unit',
                                 'resident','staff_user','contractor_company',
                                 'contractor_user','vehicle','account'
                               )),
        external_id            TEXT,
        operation              VARCHAR(30) NOT NULL
                               CHECK (operation IN (
                                 'preview_create','preview_update','preview_conflict',
                                 'preview_ignore','applied_create','applied_update',
                                 'failed','skipped'
                               )),
        status                 VARCHAR(20) NOT NULL
                               CHECK (status IN ('valid','invalid','conflict','applied','failed','skipped')),
        domhub_entity_type     VARCHAR(40),
        domhub_entity_id       UUID,
        validation_errors      JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload                JSONB NOT NULL DEFAULT '{}'::jsonb,
        normalized_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT erp_sync_records_provider_property_fk
          FOREIGN KEY (property_id, provider_config_id)
          REFERENCES erp_provider_configs(property_id, id)
          ON DELETE CASCADE,
        CONSTRAINT erp_sync_records_validation_errors_array
          CHECK (jsonb_typeof(validation_errors) = 'array')
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_records_job_status
        ON erp_sync_records(sync_job_id, status, row_index)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_records_external
        ON erp_sync_records(property_id, provider_config_id, external_entity_type, external_id)
        WHERE external_id IS NOT NULL
    `);
  },
};
