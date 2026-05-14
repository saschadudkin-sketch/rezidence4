'use strict';

// DH access-control readiness hardening.
// - request_access_links connects service work to access requests for contractor/service flows.
// - degraded checkpoint decisions get queryable reconciliation state on visit_logs_v2.

module.exports = {
  id: 'v1_049_access_readiness_gaps',
  async up(client) {
    await client.query(`
      UPDATE access_policies
         SET subject_type = 'contractor'
       WHERE subject_type = 'contractor_user'
    `);
    await client.query(`
      ALTER TABLE access_policies
        DROP CONSTRAINT IF EXISTS access_policies_subject_type_check
    `);
    await client.query(`
      ALTER TABLE access_policies
        ADD CONSTRAINT access_policies_subject_type_check
        CHECK (subject_type IN ('resident','guest','staff','contractor','vehicle','courier'))
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS request_access_links (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id          TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        access_request_id   UUID NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT request_access_links_unique UNIQUE (request_id, access_request_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_access_links_request
        ON request_access_links(request_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_access_links_access_request
        ON request_access_links(access_request_id)
    `);

    await client.query(`
      ALTER TABLE visit_logs_v2
        ADD COLUMN IF NOT EXISTS degraded_mode BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS degraded_reconciliation_state VARCHAR(20) NOT NULL DEFAULT 'not_required',
        ADD COLUMN IF NOT EXISTS degraded_reconciled_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS degraded_reconciliation_note TEXT
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'visit_logs_v2_degraded_reconciliation_state_check'
        ) THEN
          ALTER TABLE visit_logs_v2
            ADD CONSTRAINT visit_logs_v2_degraded_reconciliation_state_check
            CHECK (degraded_reconciliation_state IN ('not_required','pending','matched','discrepancy','dismissed'));
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_logs_v2_degraded_reconciliation
        ON visit_logs_v2(property_id, degraded_reconciliation_state, occurred_at DESC)
        WHERE degraded_mode = true
    `);
  },
};
