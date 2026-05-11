'use strict';

// DH-60 — sensitive-action review operations.
//
// v1_040 created durable attestations over immutable property_audit_log rows.
// This migration adds the operational layer needed for weekly review queues:
// assignment, due dates, priorities and overdue/escalation visibility.

module.exports = {
  id: 'v1_041_sensitive_review_ops',
  async up(client) {
    await client.query(`
      ALTER TABLE sensitive_action_reviews
        ADD COLUMN IF NOT EXISTS assigned_reviewer_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS assigned_by_staff_id       UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS assigned_at                TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS due_at                     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS priority                   VARCHAR(20) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS assignment_reason          TEXT,
        ADD COLUMN IF NOT EXISTS escalation_status          VARCHAR(30) NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS escalation_note            TEXT,
        ADD COLUMN IF NOT EXISTS last_escalated_at          TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE sensitive_action_reviews
        DROP CONSTRAINT IF EXISTS sensitive_action_reviews_priority_check
    `);
    await client.query(`
      ALTER TABLE sensitive_action_reviews
        ADD CONSTRAINT sensitive_action_reviews_priority_check
        CHECK (priority IN ('low','normal','high','urgent'))
    `);

    await client.query(`
      ALTER TABLE sensitive_action_reviews
        DROP CONSTRAINT IF EXISTS sensitive_action_reviews_escalation_status_check
    `);
    await client.query(`
      ALTER TABLE sensitive_action_reviews
        ADD CONSTRAINT sensitive_action_reviews_escalation_status_check
        CHECK (escalation_status IN ('none','overdue','escalated'))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_reviews_assignment
        ON sensitive_action_reviews(
          property_id,
          assigned_reviewer_staff_id,
          review_status,
          due_at
        )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_reviews_due
        ON sensitive_action_reviews(property_id, due_at)
        WHERE review_status = 'pending' AND due_at IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sensitive_action_reviews_priority
        ON sensitive_action_reviews(property_id, priority, review_status, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_property_audit_log_sensitive_review_window
        ON property_audit_log(property_id, action, created_at DESC)
        WHERE action IS NOT NULL
    `);
  },
};
