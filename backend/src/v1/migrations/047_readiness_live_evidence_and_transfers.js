'use strict';

// DH-55/DH-57/DH-59/DH-60 follow-up.
//
// Adds forward-only tables for real ownership-transfer operations, formal
// resident notification preferences, and live rollout/report evidence.

function addConstraintIfMissing(name, sql) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${name}'
      ) THEN
        ${sql}
      END IF;
    END $$;
  `;
}

module.exports = {
  id: 'v1_047_readiness_live_evidence_and_transfers',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS resident_notification_preferences (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                UUID NOT NULL,
        resident_id                UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        channel                    VARCHAR(20) NOT NULL,
        event_scope                VARCHAR(60) NOT NULL DEFAULT 'all',
        enabled                    BOOLEAN NOT NULL DEFAULT true,
        quiet_hours                JSONB NOT NULL DEFAULT '{}'::jsonb,
        source                     VARCHAR(30) NOT NULL DEFAULT 'resident_ui',
        inherited_from_resident_id UUID REFERENCES residents(id) ON DELETE SET NULL,
        cascaded_at                TIMESTAMPTZ,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT resident_notification_preferences_channel_check CHECK (
          channel IN ('web_push','sms','telegram','email')
        ),
        CONSTRAINT resident_notification_preferences_source_check CHECK (
          source IN ('resident_ui','admin','import','ownership_transfer','offboarding')
        ),
        CONSTRAINT resident_notification_preferences_scope_nonempty CHECK (
          length(trim(event_scope)) > 0
        ),
        CONSTRAINT resident_notification_preferences_unique UNIQUE (
          property_id, resident_id, channel, event_scope
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_notification_preferences_resident
        ON resident_notification_preferences(property_id, resident_id, enabled)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_notification_preferences_inherited
        ON resident_notification_preferences(inherited_from_resident_id, cascaded_at DESC)
        WHERE inherited_from_resident_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS resident_ownership_transfers (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id       UUID NOT NULL,
        unit_id           UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        from_resident_id  UUID NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        to_resident_id    UUID NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
        transfer_reason   TEXT NOT NULL,
        effective_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cascade_policy    JSONB NOT NULL DEFAULT '{}'::jsonb,
        summary           JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_uid         TEXT,
        actor_role        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT resident_ownership_transfers_distinct CHECK (
          from_resident_id <> to_resident_id
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_ownership_transfers_property
        ON resident_ownership_transfers(property_id, effective_at DESC, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_ownership_transfers_unit
        ON resident_ownership_transfers(property_id, unit_id, created_at DESC)
    `);

    await client.query(`
      ALTER TABLE resident_lifecycle_events
        DROP CONSTRAINT IF EXISTS resident_lifecycle_events_event_type_check
    `);

    await client.query(addConstraintIfMissing(
      'resident_lifecycle_events_event_type_check',
      `ALTER TABLE resident_lifecycle_events
         ADD CONSTRAINT resident_lifecycle_events_event_type_check
         CHECK (event_type IN (
           'created','updated','unit_changed','profile_changed',
           'deactivated','reactivated','consent_given','consent_revoked',
           'ownership_transferred','notification_preferences_cascaded'
         ));`,
    ));

    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_provider_delivery_evidence (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id          UUID NOT NULL,
        request_id           TEXT REFERENCES requests(id) ON DELETE SET NULL,
        drill_id             UUID REFERENCES emergency_dispatch_drills(id) ON DELETE SET NULL,
        provider             VARCHAR(40) NOT NULL,
        channel              VARCHAR(30) NOT NULL,
        scenario_type        VARCHAR(40) NOT NULL,
        status               VARCHAR(30) NOT NULL,
        latency_ms           INTEGER,
        external_delivery_id TEXT,
        observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recorded_by_uid      TEXT,
        payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT emergency_provider_delivery_latency CHECK (
          latency_ms IS NULL OR latency_ms >= 0
        )
      )
    `);

    await client.query(addConstraintIfMissing(
      'emergency_provider_delivery_channel_check',
      `ALTER TABLE emergency_provider_delivery_evidence
         ADD CONSTRAINT emergency_provider_delivery_channel_check
         CHECK (channel IN (
           'web_push','sms','telegram','email','phone','webhook',
           'external_dispatch','contractor_company','internal_roster'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_provider_delivery_status_check',
      `ALTER TABLE emergency_provider_delivery_evidence
         ADD CONSTRAINT emergency_provider_delivery_status_check
         CHECK (status IN (
           'sent','delivered','acknowledged','failed','timed_out','not_required'
         ));`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_provider_delivery_property
        ON emergency_provider_delivery_evidence(property_id, observed_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_provider_delivery_request
        ON emergency_provider_delivery_evidence(request_id, observed_at DESC)
        WHERE request_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS skud_field_rollout_evidence (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id        UUID NOT NULL,
        provider_config_id UUID REFERENCES skud_provider_configs(id) ON DELETE SET NULL,
        hardware_device_id UUID REFERENCES skud_hardware_devices(id) ON DELETE SET NULL,
        rollout_stage      VARCHAR(30) NOT NULL DEFAULT 'pilot',
        evidence_type      VARCHAR(40) NOT NULL,
        status             VARCHAR(30) NOT NULL,
        summary            TEXT,
        metrics            JSONB NOT NULL DEFAULT '{}'::jsonb,
        observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recorded_by_uid    TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(addConstraintIfMissing(
      'skud_field_rollout_stage_check',
      `ALTER TABLE skud_field_rollout_evidence
         ADD CONSTRAINT skud_field_rollout_stage_check
         CHECK (rollout_stage IN ('lab','staging','pilot','production'));`,
    ));

    await client.query(addConstraintIfMissing(
      'skud_field_rollout_type_check',
      `ALTER TABLE skud_field_rollout_evidence
         ADD CONSTRAINT skud_field_rollout_type_check
         CHECK (evidence_type IN (
           'provider_delivery','field_drill','rollout_report','vendor_health_probe'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'skud_field_rollout_status_check',
      `ALTER TABLE skud_field_rollout_evidence
         ADD CONSTRAINT skud_field_rollout_status_check
         CHECK (status IN ('planned','running','passed','failed','blocked'));`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_field_rollout_property
        ON skud_field_rollout_evidence(property_id, observed_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_field_rollout_provider
        ON skud_field_rollout_evidence(provider_config_id, observed_at DESC)
        WHERE provider_config_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sensitive_action_report_evidence (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id      UUID NOT NULL,
        report_type      VARCHAR(40) NOT NULL,
        status           VARCHAR(30) NOT NULL DEFAULT 'generated',
        period_from      TIMESTAMPTZ,
        period_to        TIMESTAMPTZ,
        summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_by_uid TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT sensitive_action_report_period CHECK (
          period_to IS NULL OR period_from IS NULL OR period_to >= period_from
        )
      )
    `);

    await client.query(addConstraintIfMissing(
      'sensitive_action_report_type_check',
      `ALTER TABLE sensitive_action_report_evidence
         ADD CONSTRAINT sensitive_action_report_type_check
         CHECK (report_type IN (
           'summary','anti_abuse','escalation','attestation','live_rollout'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'sensitive_action_report_status_check',
      `ALTER TABLE sensitive_action_report_evidence
         ADD CONSTRAINT sensitive_action_report_status_check
         CHECK (status IN ('generated','reviewed','failed'));`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_report_property
        ON sensitive_action_report_evidence(property_id, report_type, created_at DESC)
    `);
  },
};
