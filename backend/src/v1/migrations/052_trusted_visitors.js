'use strict';

// Access rollout Phase 4 — resident-owned frequent guests / trusted visitors.
// A trusted visitor is a reusable resident-scoped template. Actual entry is
// still represented by normal audited access_requests + passes.

module.exports = {
  id: 'v1_052_trusted_visitors',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trusted_visitors (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        resident_id            UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        name                   TEXT NOT NULL,
        phone                  TEXT,
        visitor_type           VARCHAR(40) NOT NULL DEFAULT 'guest',
        default_vehicle_plate  TEXT,
        default_instructions   TEXT,
        allowed_zone_id        UUID,
        allowed_point_id       UUID,
        is_active              BOOLEAN NOT NULL DEFAULT true,
        last_used_at           TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT trusted_visitors_name_not_blank
          CHECK (length(trim(name)) > 0),
        CONSTRAINT trusted_visitors_type_check
          CHECK (visitor_type IN (
            'guest','relative','cleaner','courier','service','caregiver','other'
          ))
      )
    `);

    await client.query(`
      ALTER TABLE access_requests
        ADD COLUMN IF NOT EXISTS trusted_visitor_id UUID
    `);

    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_trusted_visitor_fk
    `);

    await client.query(`
      ALTER TABLE access_requests
        ADD CONSTRAINT access_requests_trusted_visitor_fk
        FOREIGN KEY (trusted_visitor_id)
        REFERENCES trusted_visitors(id)
        ON DELETE SET NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trusted_visitors_resident_active
        ON trusted_visitors (resident_id, is_active, updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trusted_visitors_property
        ON trusted_visitors (property_id, is_active, updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_trusted_visitor
        ON access_requests (trusted_visitor_id, created_at DESC)
        WHERE trusted_visitor_id IS NOT NULL
    `);
  },
};
