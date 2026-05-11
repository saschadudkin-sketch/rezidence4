'use strict';

// DH-57 — emergency dispatch runtime.
//
// Service requests already carry priority/SLA fields.  This migration adds an
// emergency-specific operational profile so urgent cases have explicit
// severity, escalation target, dispatch status and audit timestamps without
// overloading the generic requests row.

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
  id: 'v1_043_emergency_dispatch_mode',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_request_profiles (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id           UUID,
        request_id            TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        emergency_type        VARCHAR(40) NOT NULL,
        severity              VARCHAR(10) NOT NULL DEFAULT 'P1',
        dispatch_status       VARCHAR(30) NOT NULL DEFAULT 'new',
        escalation_target     VARCHAR(40) NOT NULL DEFAULT 'concierge',
        first_response_due_at TIMESTAMPTZ,
        resolution_due_at     TIMESTAMPTZ,
        acknowledged_at       TIMESTAMPTZ,
        acknowledged_by_uid   TEXT,
        dispatched_at         TIMESTAMPTZ,
        dispatched_by_uid     TEXT,
        escalated_at          TIMESTAMPTZ,
        escalated_by_uid      TEXT,
        resolved_at           TIMESTAMPTZ,
        notification_status   VARCHAR(30) NOT NULL DEFAULT 'pending',
        metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT emergency_request_profiles_request_unique UNIQUE (request_id)
      )
    `);

    await client.query(addConstraintIfMissing(
      'emergency_request_profiles_type_check',
      `ALTER TABLE emergency_request_profiles
         ADD CONSTRAINT emergency_request_profiles_type_check
         CHECK (emergency_type IN (
           'water','heating','electricity','fire_smoke','access_control',
           'security','territory','contractor','other'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_request_profiles_severity_check',
      `ALTER TABLE emergency_request_profiles
         ADD CONSTRAINT emergency_request_profiles_severity_check
         CHECK (severity IN ('P0','P1','P2'));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_request_profiles_dispatch_status_check',
      `ALTER TABLE emergency_request_profiles
         ADD CONSTRAINT emergency_request_profiles_dispatch_status_check
         CHECK (dispatch_status IN ('new','acknowledged','dispatched','escalated','resolved','cancelled'));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_request_profiles_target_check',
      `ALTER TABLE emergency_request_profiles
         ADD CONSTRAINT emergency_request_profiles_target_check
         CHECK (escalation_target IN (
           'security','concierge','technician','contractor','property_admin','management_company_admin'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'emergency_request_profiles_notification_status_check',
      `ALTER TABLE emergency_request_profiles
         ADD CONSTRAINT emergency_request_profiles_notification_status_check
         CHECK (notification_status IN ('pending','sent','failed','not_required'));`,
    ));

    await client.query(`
      INSERT INTO emergency_request_profiles
        (request_id, emergency_type, severity, escalation_target,
         first_response_due_at, resolution_due_at, metadata)
      SELECT r.id,
             CASE
               WHEN r.category LIKE '%water%' THEN 'water'
               WHEN r.category LIKE '%heating%' THEN 'heating'
               WHEN r.category LIKE '%electric%' THEN 'electricity'
               WHEN r.category LIKE '%fire%' OR r.category LIKE '%smoke%' THEN 'fire_smoke'
               WHEN r.category LIKE '%access%' OR r.category LIKE '%barrier%' THEN 'access_control'
               WHEN r.category LIKE '%security%' THEN 'security'
               WHEN r.category LIKE '%contractor%' THEN 'contractor'
               ELSE 'other'
             END,
             CASE
               WHEN r.category LIKE '%fire%' OR r.category LIKE '%smoke%' OR r.category LIKE '%security%' THEN 'P0'
               WHEN r.category LIKE '%contractor%' THEN 'P2'
               ELSE 'P1'
             END,
             CASE
               WHEN r.category LIKE '%fire%' OR r.category LIKE '%smoke%' OR r.category LIKE '%security%' THEN 'security'
               WHEN r.category LIKE '%contractor%' THEN 'contractor'
               WHEN r.category LIKE '%access%' OR r.category LIKE '%barrier%' THEN 'security'
               ELSE 'technician'
             END,
             r.first_response_due_at,
             r.resolution_due_at,
             jsonb_build_object('backfilled', true, 'category', r.category)
        FROM requests r
       WHERE (r.priority = 'emergency' OR r.sla_profile = 'emergency')
         AND NOT EXISTS (
           SELECT 1 FROM emergency_request_profiles p WHERE p.request_id = r.id
         )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_profiles_queue
        ON emergency_request_profiles(dispatch_status, severity, first_response_due_at, created_at DESC)
        WHERE dispatch_status NOT IN ('resolved','cancelled')
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_profiles_request
        ON emergency_request_profiles(request_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_profiles_property
        ON emergency_request_profiles(property_id, dispatch_status, severity, created_at DESC)
    `);
  },
};
