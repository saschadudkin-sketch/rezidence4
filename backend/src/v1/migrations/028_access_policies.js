'use strict';

// platform-v1 property-DB migration 028 — access policies.
//
// DH-13/DH-14 adds object-level policy CRUD and deterministic policy
// evaluation. Existing hard verification checks stay in verifyPass; policies
// add configurable subject/method/scope/schedule decisions on top.

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
  id: 'v1_028_access_policies',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_policies (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id          UUID NOT NULL,
        name                VARCHAR(100) NOT NULL,
        subject_type        VARCHAR(30) NOT NULL
                            CHECK (subject_type IN (
                              'resident','guest','staff','contractor',
                              'vehicle','courier'
                            )),
        subject_role        VARCHAR(30),
        zone_id             UUID,
        point_id            UUID,
        access_method       VARCHAR(30) NOT NULL
                            CHECK (access_method IN (
                              'qr','manual','plate','ble','card','face','pin'
                            )),
        approval_mode       VARCHAR(20) NOT NULL DEFAULT 'required'
                            CHECK (approval_mode IN (
                              'auto','required','security_only','admin_only'
                            )),
        effect              VARCHAR(30) NOT NULL DEFAULT 'allow'
                            CHECK (effect IN (
                              'allow','deny','needs_approval',
                              'needs_security_review','incident_required'
                            )),
        priority            INTEGER NOT NULL DEFAULT 100,
        schedule_json       JSONB,
        duration_minutes    INTEGER,
        is_recurring        BOOLEAN NOT NULL DEFAULT false,
        is_active           BOOLEAN NOT NULL DEFAULT true,
        created_by          UUID,
        metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT access_policies_property_id_unique UNIQUE (property_id, id),
        CONSTRAINT access_policies_duration_positive CHECK (
          duration_minutes IS NULL OR duration_minutes > 0
        ),
        CONSTRAINT access_policies_zone_property_fk
          FOREIGN KEY (property_id, zone_id)
          REFERENCES access_zones(property_id, id)
          ON DELETE RESTRICT,
        CONSTRAINT access_policies_point_property_fk
          FOREIGN KEY (property_id, point_id)
          REFERENCES access_points(property_id, id)
          ON DELETE RESTRICT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_policies_property_active
        ON access_policies(property_id, is_active, subject_type, access_method, priority)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_policies_zone
        ON access_policies(property_id, zone_id, is_active)
        WHERE zone_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_policies_point
        ON access_policies(property_id, point_id, is_active)
        WHERE point_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_access_policies_property_name_active
        ON access_policies(property_id, LOWER(name))
        WHERE is_active = true
    `);

    await client.query(addConstraintIfMissing(
      'passes_policy_fk',
      `ALTER TABLE passes
         ADD CONSTRAINT passes_policy_fk
         FOREIGN KEY (property_id, policy_id)
         REFERENCES access_policies(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'access_incidents_incident_type_check'
        ) THEN
          ALTER TABLE access_incidents
            DROP CONSTRAINT access_incidents_incident_type_check;
        END IF;

        ALTER TABLE access_incidents
          ADD CONSTRAINT access_incidents_incident_type_check
          CHECK (incident_type IN (
            'expired_pass_attempt','invalid_qr','blacklist_hit',
            'outside_time_window','unauthorized_vehicle',
            'manual_override','provider_conflict',
            'suspicious_repeat_attempt','policy_denied',
            'policy_security_review_required'
          ));
      END $$;
    `);
  },
};
