'use strict';

// platform-v1 property-DB migration 002 — entrances (Фаза 2 Structure layer).
// Spec: docs/product/specs/platform-v1/units-spec.md §2.
//
// Entrance is the addressable unit between a building and individual units —
// lets us attach access_policies or announcements to "all of entrance B2"
// without touching every unit_id.  FK on building_id is RESTRICT because
// deleting a building that still owns entrances must be a deliberate
// two-step operation (same rationale as for units → residents).

module.exports = {
  id: 'v1_002_entrances',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS entrances (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
        code         VARCHAR(50),
        name         VARCHAR(100) NOT NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_entrances_building_code
        ON entrances(building_id, code) WHERE code IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_entrances_building
        ON entrances(building_id, sort_order)
    `);
  },
};
