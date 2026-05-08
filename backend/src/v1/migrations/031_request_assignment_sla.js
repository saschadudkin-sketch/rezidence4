'use strict';

// platform-v1 property-DB migration 031 — request assignment, SLA and escalation.
//
// DH-24 turns service requests into managed operational work items: assignment
// metadata, first-response/resolution timestamps, deterministic SLA state and
// persisted escalation events for downstream notifications/reporting.

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
  id: 'v1_031_request_assignment_sla',
  async up(client) {
    await client.query(`
      ALTER TABLE requests
        ADD COLUMN IF NOT EXISTS assigned_to_uid TEXT,
        ADD COLUMN IF NOT EXISTS assigned_to_name TEXT,
        ADD COLUMN IF NOT EXISTS assigned_to_role TEXT,
        ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sla_state VARCHAR(30) NOT NULL DEFAULT 'on_track',
        ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
        ADD COLUMN IF NOT EXISTS last_sla_check_at TIMESTAMPTZ
    `);

    await client.query(addConstraintIfMissing(
      'requests_assigned_to_role_check',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_assigned_to_role_check
         CHECK (
           assigned_to_role IS NULL OR assigned_to_role IN (
             'security','concierge','technician','contractor','property_admin','admin'
           )
         );`,
    ));

    await client.query(addConstraintIfMissing(
      'requests_sla_state_check',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_sla_state_check
         CHECK (sla_state IN ('on_track','responded','escalated','emergency_escalated','resolved'));`,
    ));

    await client.query(addConstraintIfMissing(
      'requests_escalation_level_nonnegative',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_escalation_level_nonnegative
         CHECK (escalation_level >= 0);`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_assignment_queue
        ON requests(assigned_to_uid, status, created_at DESC)
        WHERE assigned_to_uid IS NOT NULL AND deleted_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_sla_due_queue
        ON requests(priority, sla_profile, first_response_due_at, resolution_due_at)
        WHERE deleted_at IS NULL
          AND status NOT IN ('completed','cancelled','rejected','expired')
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS request_sla_events (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        event_key     TEXT NOT NULL,
        event_type    VARCHAR(40) NOT NULL
                      CHECK (event_type IN (
                        'first_response_overdue','resolution_overdue',
                        'emergency_escalated','manual_escalation'
                      )),
        severity      VARCHAR(20) NOT NULL
                      CHECK (severity IN ('warning','breach','emergency')),
        due_at        TIMESTAMPTZ,
        detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT request_sla_events_key_unique UNIQUE (request_id, event_key)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_sla_events_request
        ON request_sla_events(request_id, detected_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_sla_events_type
        ON request_sla_events(event_type, severity, detected_at DESC)
    `);
  },
};
