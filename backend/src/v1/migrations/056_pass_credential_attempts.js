'use strict';

// Access rollout hardening: keep credential-derived rate-limit material out of
// visit/audit/export payloads while preserving per-credential PIN throttling.

module.exports = {
  id: 'v1_056_pass_credential_attempts',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pass_credential_attempts (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        credential_type        VARCHAR(20) NOT NULL
                               CHECK (credential_type IN ('pin')),
        credential_fingerprint TEXT NOT NULL,
        access_point_id        UUID,
        performed_by_staff_id  UUID,
        visit_log_id           UUID REFERENCES visit_logs_v2(id) ON DELETE SET NULL,
        occurred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT pass_credential_attempts_fingerprint_not_blank
          CHECK (length(trim(credential_fingerprint)) > 0),
        CONSTRAINT pass_credential_attempts_access_point_fk
          FOREIGN KEY (property_id, access_point_id)
          REFERENCES access_points(property_id, id)
          ON DELETE SET NULL
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pass_credential_attempts_fingerprint_window
        ON pass_credential_attempts
          (property_id, credential_type, credential_fingerprint, occurred_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pass_credential_attempts_property_window
        ON pass_credential_attempts (property_id, credential_type, occurred_at DESC)
    `);
  },
};
