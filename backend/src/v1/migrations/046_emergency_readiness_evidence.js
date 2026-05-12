'use strict';

// DH-57 — emergency dispatch readiness evidence.
//
// The dispatch runtime already has per-request emergency profiles.  This
// migration adds operational evidence tables for active on-call coverage and
// repeatable emergency drill records without coupling DomHub to a telephony
// dispatch-center integration.

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
  id: 'v1_046_emergency_readiness_evidence',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_on_call_rosters (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id        UUID NOT NULL,
        escalation_target  VARCHAR(40) NOT NULL,
        display_name       TEXT NOT NULL,
        provider           VARCHAR(40) NOT NULL DEFAULT 'internal_roster',
        contact_ref        TEXT,
        status             VARCHAR(20) NOT NULL DEFAULT 'active',
        starts_at          TIMESTAMPTZ,
        ends_at            TIMESTAMPTZ,
        priority           INTEGER NOT NULL DEFAULT 100,
        metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_uid     TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(addConstraintIfMissing(
      'emergency_on_call_rosters_target_check',
      `ALTER TABLE emergency_on_call_rosters
         ADD CONSTRAINT emergency_on_call_rosters_target_check
         CHECK (escalation_target IN (
           'security','concierge','technician','contractor','property_admin','management_company_admin'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_on_call_rosters_provider_check',
      `ALTER TABLE emergency_on_call_rosters
         ADD CONSTRAINT emergency_on_call_rosters_provider_check
         CHECK (provider IN (
           'internal_roster','sms','telegram','web_push','external_dispatch','contractor_company'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_on_call_rosters_status_check',
      `ALTER TABLE emergency_on_call_rosters
         ADD CONSTRAINT emergency_on_call_rosters_status_check
         CHECK (status IN ('active','disabled','archived'));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_on_call_rosters_window_check',
      `ALTER TABLE emergency_on_call_rosters
         ADD CONSTRAINT emergency_on_call_rosters_window_check
         CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_on_call_rosters_active
        ON emergency_on_call_rosters(property_id, status, escalation_target, priority)
        WHERE status = 'active'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_dispatch_drills (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        scenario_type          VARCHAR(40) NOT NULL,
        severity               VARCHAR(10) NOT NULL DEFAULT 'P1',
        escalation_target      VARCHAR(40) NOT NULL,
        request_id             TEXT REFERENCES requests(id) ON DELETE SET NULL,
        status                 VARCHAR(20) NOT NULL DEFAULT 'planned',
        started_at             TIMESTAMPTZ,
        completed_at           TIMESTAMPTZ,
        created_by_uid         TEXT,
        summary                TEXT,
        findings               JSONB NOT NULL DEFAULT '{}'::jsonb,
        notification_evidence  JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(addConstraintIfMissing(
      'emergency_dispatch_drills_type_check',
      `ALTER TABLE emergency_dispatch_drills
         ADD CONSTRAINT emergency_dispatch_drills_type_check
         CHECK (scenario_type IN (
           'water','heating','electricity','fire_smoke','access_control',
           'security','territory','contractor','other'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_dispatch_drills_severity_check',
      `ALTER TABLE emergency_dispatch_drills
         ADD CONSTRAINT emergency_dispatch_drills_severity_check
         CHECK (severity IN ('P0','P1','P2'));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_dispatch_drills_target_check',
      `ALTER TABLE emergency_dispatch_drills
         ADD CONSTRAINT emergency_dispatch_drills_target_check
         CHECK (escalation_target IN (
           'security','concierge','technician','contractor','property_admin','management_company_admin'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_dispatch_drills_status_check',
      `ALTER TABLE emergency_dispatch_drills
         ADD CONSTRAINT emergency_dispatch_drills_status_check
         CHECK (status IN ('planned','running','passed','failed','cancelled'));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_dispatch_drills_window_check',
      `ALTER TABLE emergency_dispatch_drills
         ADD CONSTRAINT emergency_dispatch_drills_window_check
         CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at);`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_dispatch_drills_property
        ON emergency_dispatch_drills(property_id, (COALESCE(started_at, created_at)) DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_dispatch_drills_status
        ON emergency_dispatch_drills(property_id, status, severity, created_at DESC)
    `);
  },
};
