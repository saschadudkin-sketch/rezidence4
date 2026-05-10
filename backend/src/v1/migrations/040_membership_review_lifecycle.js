'use strict';

// platform-v1 property-DB migration 040.
//
// Closes the remaining DH-03/DH-08/DH-17..21 persistence gaps:
// - role_scope_memberships can now represent property-local mirrors of
//   management-company/platform subjects and stores provisioning metadata.
// - sensitive_action_reviews adds a durable attestation workflow over
//   property_audit_log without mutating immutable audit rows.
// - resident lifecycle/consent tables preserve personal-data decisions.
// - security_offline_replay_events gives guard consoles an idempotent replay
//   ledger for degraded checkpoint mode.

module.exports = {
  id: 'v1_040_membership_review_lifecycle',
  async up(client) {
    await client.query(`
      ALTER TABLE role_scope_memberships
        ADD COLUMN IF NOT EXISTS external_subject_type VARCHAR(40),
        ADD COLUMN IF NOT EXISTS external_subject_id   TEXT,
        ADD COLUMN IF NOT EXISTS management_company_id UUID,
        ADD COLUMN IF NOT EXISTS provisioned_from      VARCHAR(40) NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS provisioned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS revoked_at            TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS revoked_reason        TEXT
    `);

    await client.query(`
      ALTER TABLE role_scope_memberships
        DROP CONSTRAINT IF EXISTS role_scope_memberships_role_check,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_scope_level_check,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_status_check,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_subject_exclusive,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_scope_consistent,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_subject_role,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_external_subject_pair,
        DROP CONSTRAINT IF EXISTS role_scope_memberships_provisioned_from_check
    `);

    await client.query(`
      ALTER TABLE role_scope_memberships
        ADD CONSTRAINT role_scope_memberships_role_check CHECK (role IN (
          'resident','security','concierge','technician','contractor',
          'property_admin','management_company_admin','platform_admin'
        )),
        ADD CONSTRAINT role_scope_memberships_scope_level_check CHECK (scope_level IN (
          'platform','management_company','property','building','entrance','floor','unit',
          'parking_zone','access_zone','access_point'
        )),
        ADD CONSTRAINT role_scope_memberships_status_check CHECK (
          status IN ('active','suspended','revoked','expired')
        ),
        ADD CONSTRAINT role_scope_memberships_provisioned_from_check CHECK (
          provisioned_from IN ('manual','api','import','bootstrap','platform_sync')
        ),
        ADD CONSTRAINT role_scope_memberships_external_subject_pair CHECK (
          (external_subject_type IS NULL AND external_subject_id IS NULL)
          OR
          (external_subject_type IS NOT NULL AND external_subject_id IS NOT NULL)
        ),
        ADD CONSTRAINT role_scope_memberships_subject_exclusive CHECK (
          ((resident_id IS NOT NULL)::int
         + (staff_user_id IS NOT NULL)::int
         + (contractor_user_id IS NOT NULL)::int
         + (external_subject_id IS NOT NULL)::int) = 1
        ),
        ADD CONSTRAINT role_scope_memberships_scope_consistent CHECK (
          (scope_level = 'platform' AND scope_id IS NULL)
          OR
          (scope_level = 'management_company' AND (scope_id IS NOT NULL OR management_company_id IS NOT NULL))
          OR
          (scope_level = 'property' AND scope_id IS NULL)
          OR
          (scope_level NOT IN ('platform','management_company','property') AND scope_id IS NOT NULL)
        ),
        ADD CONSTRAINT role_scope_memberships_subject_role CHECK (
          (resident_id IS NOT NULL AND role = 'resident')
          OR
          (contractor_user_id IS NOT NULL AND role = 'contractor')
          OR
          (staff_user_id IS NOT NULL AND role IN (
            'security','concierge','technician','property_admin',
            'management_company_admin','platform_admin'
          ))
          OR
          (external_subject_id IS NOT NULL AND role IN (
            'management_company_admin','platform_admin'
          ))
        )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_external
        ON role_scope_memberships(external_subject_type, external_subject_id, status)
        WHERE external_subject_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_management_company
        ON role_scope_memberships(management_company_id, status, role)
        WHERE management_company_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_scope_memberships_external_active
        ON role_scope_memberships(
          property_id,
          external_subject_type,
          external_subject_id,
          role,
          scope_level,
          COALESCE(scope_id, management_company_id, property_id)
        )
        WHERE external_subject_id IS NOT NULL AND status = 'active'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sensitive_action_reviews (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        audit_log_id            UUID NOT NULL REFERENCES property_audit_log(id) ON DELETE CASCADE,
        property_id             UUID,
        category                VARCHAR(60) NOT NULL,
        action                  VARCHAR(100) NOT NULL,
        resource_type           VARCHAR(50) NOT NULL,
        resource_id             TEXT,
        review_status           VARCHAR(30) NOT NULL DEFAULT 'pending'
                                CHECK (review_status IN (
                                  'pending','approved','needs_followup','dismissed'
                                )),
        review_reason           TEXT,
        reviewer_staff_id       UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        reviewed_at             TIMESTAMPTZ,
        comment                 TEXT,
        classification_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT sensitive_action_reviews_audit_log_unique UNIQUE (audit_log_id),
        CONSTRAINT sensitive_action_reviews_reviewed_state CHECK (
          review_status = 'pending'
          OR (reviewer_staff_id IS NOT NULL AND reviewed_at IS NOT NULL)
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_reviews_property_status
        ON sensitive_action_reviews(property_id, review_status, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_reviews_category
        ON sensitive_action_reviews(category, review_status, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS resident_lifecycle_events (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id    UUID NOT NULL,
        resident_id    UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        event_type     VARCHAR(40) NOT NULL
                       CHECK (event_type IN (
                         'created','updated','unit_changed','profile_changed',
                         'deactivated','reactivated','consent_given','consent_revoked'
                       )),
        actor_uid      TEXT,
        actor_role     TEXT,
        metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_lifecycle_events_resident
        ON resident_lifecycle_events(resident_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_lifecycle_events_property_type
        ON resident_lifecycle_events(property_id, event_type, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS resident_consent_history (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id     UUID NOT NULL,
        resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        consent_version VARCHAR(40) NOT NULL,
        decision        VARCHAR(20) NOT NULL
                        CHECK (decision IN ('accepted','revoked')),
        source          VARCHAR(30) NOT NULL DEFAULT 'resident_ui'
                        CHECK (source IN ('resident_ui','admin','import','api')),
        actor_uid       TEXT,
        ip_address      VARCHAR(45),
        user_agent      TEXT,
        evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_consent_history_resident
        ON resident_consent_history(resident_id, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS security_offline_replay_events (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        client_event_id        TEXT NOT NULL,
        access_point_id        UUID REFERENCES access_points(id) ON DELETE SET NULL,
        performed_by_staff_id  UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        event_type             VARCHAR(30) NOT NULL
                              CHECK (event_type IN (
                                'manual_admit','manual_deny','lookup_snapshot','sync_error'
                              )),
        replay_status          VARCHAR(20) NOT NULL DEFAULT 'accepted'
                              CHECK (replay_status IN ('accepted','duplicate','rejected')),
        occurred_at            TIMESTAMPTZ NOT NULL,
        payload                JSONB NOT NULL DEFAULT '{}'::jsonb,
        processed_at           TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT security_offline_replay_events_client_unique UNIQUE (property_id, client_event_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_security_offline_replay_events_property_time
        ON security_offline_replay_events(property_id, occurred_at DESC)
    `);

    await client.query(`
      ALTER TABLE visit_logs_v2
        ADD COLUMN IF NOT EXISTS offline_replay_event_id UUID
          REFERENCES security_offline_replay_events(id) ON DELETE SET NULL
    `);
  },
};
