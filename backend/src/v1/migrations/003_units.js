'use strict';

// platform-v1 property-DB migration 003 — units (Фаза 2 Structure layer).
// Spec: docs/product/specs/platform-v1/units-spec.md §2.
//
// `building_id` and `property_id` are denormalised alongside the FK on
// entrance_id — they let access-policy and audit queries filter without a
// two-hop join through entrances.  The denormalised values are enforced to
// match on insert/update by the service layer (not the DB, because that would
// require triggers and complicate per-property isolation).
//
// The UNIQUE index on (property_id, building_id, entrance_id, unit_number)
// catches "12А" vs "12A" only after service-layer normalisation — see
// units-spec §4.  unit_type enum is CHECK'ed here to match the data-model
// spec exactly.

module.exports = {
  id: 'v1_003_units',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS units (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id  UUID NOT NULL,
        building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
        entrance_id  UUID NOT NULL REFERENCES entrances(id) ON DELETE RESTRICT,
        unit_number  VARCHAR(30) NOT NULL,
        unit_type    VARCHAR(20) NOT NULL DEFAULT 'apartment'
                     CHECK (unit_type IN ('apartment','townhouse','house','commercial','utility')),
        floor        INTEGER,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_units_identity
        ON units(property_id, building_id, entrance_id, unit_number)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_units_property_active
        ON units(property_id, is_active)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_units_entrance
        ON units(entrance_id, is_active)
    `);
  },
};
