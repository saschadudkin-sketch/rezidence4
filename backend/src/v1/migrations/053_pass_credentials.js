'use strict';

// Access rollout Phase 5 — pass credential layer.
// `passes` remains the business entity; credentials are replaceable material
// for the same pass lifecycle. PIN verification uses `credential_hash`; the
// encrypted display fields are only for policy-controlled public pass display.

module.exports = {
  id: 'v1_053_pass_credentials',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pass_credentials (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id       UUID NOT NULL,
        pass_id           UUID NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
        credential_type   VARCHAR(20) NOT NULL
                          CHECK (credential_type IN ('qr','pin','plate')),
        token             TEXT,
        credential_hash   TEXT,
        credential_ciphertext TEXT,
        credential_iv     TEXT,
        credential_tag    TEXT,
        render_version    SMALLINT NOT NULL DEFAULT 1,
        expires_at        TIMESTAMPTZ,
        used_at           TIMESTAMPTZ,
        revoked_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT pass_credentials_render_positive
          CHECK (render_version >= 1),
        CONSTRAINT pass_credentials_material_shape CHECK (
          (credential_type = 'qr'
             AND token IS NOT NULL
             AND credential_hash IS NULL)
          OR (credential_type IN ('pin','plate')
             AND token IS NULL
             AND credential_hash IS NOT NULL)
        ),
        CONSTRAINT pass_credentials_display_secret_shape CHECK (
          (
            credential_ciphertext IS NULL
            AND credential_iv IS NULL
            AND credential_tag IS NULL
          )
          OR (
            credential_ciphertext IS NOT NULL
            AND credential_iv IS NOT NULL
            AND credential_tag IS NOT NULL
          )
        )
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pass_credentials_token
        ON pass_credentials(token)
        WHERE token IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pass_credentials_active_type
        ON pass_credentials(pass_id, credential_type)
        WHERE revoked_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pass_credentials_property_type
        ON pass_credentials(property_id, credential_type, updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pass_credentials_pass
        ON pass_credentials(pass_id, credential_type)
    `);

    await client.query(`
      INSERT INTO pass_credentials
        (property_id, pass_id, credential_type, token, render_version, created_at, updated_at)
      SELECT q.property_id, q.pass_id, 'qr', q.token, q.render_version, q.created_at, q.updated_at
        FROM qr_passes_v2 q
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      ALTER TABLE access_incidents
        DROP CONSTRAINT IF EXISTS access_incidents_incident_type_check
    `);

    await client.query(`
      ALTER TABLE access_incidents
        ADD CONSTRAINT access_incidents_incident_type_check
        CHECK (incident_type IN (
          'expired_pass_attempt','invalid_qr','invalid_pin','blacklist_hit',
          'outside_time_window','unauthorized_vehicle',
          'manual_override','provider_conflict',
          'suspicious_repeat_attempt'
        ))
    `);
  },
};
