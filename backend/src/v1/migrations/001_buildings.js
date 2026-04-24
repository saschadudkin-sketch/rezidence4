'use strict';

// platform-v1 property-DB migration 001 — buildings (Фаза 2 Structure layer).
// Spec: docs/product/specs/platform-v1/units-spec.md §2.
//
// Parent of entrances/units.  For single-building Замоскворечье we seed one
// building with code='main' during Фаза 7 onboarding; the schema is the same
// as for future multi-building objects.  No legacy FK at this stage — wiring
// of residents/requests to unit_id happens in Фаза 7.

module.exports = {
  id: 'v1_001_buildings',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS buildings (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id  UUID NOT NULL,
        code         VARCHAR(50),
        name         VARCHAR(100) NOT NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // (property_id, code) must be unique only when code is non-null — partial
    // unique index lets us keep code optional for cottage-type properties.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_buildings_property_code
        ON buildings(property_id, code) WHERE code IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_buildings_property
        ON buildings(property_id, sort_order)
    `);
  },
};
