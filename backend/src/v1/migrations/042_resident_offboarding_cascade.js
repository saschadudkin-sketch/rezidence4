'use strict';

// DH-55 — resident offboarding cascade.
//
// The resident row already has unit_id/is_active, but operational modules
// need an explicit resident-unit link table for household/unit membership and
// offboarding.  Vehicles also need a non-destructive "review required" marker:
// we keep history and blacklist state, but remove whitelist access.

module.exports = {
  id: 'v1_042_resident_offboarding_cascade',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS resident_unit_links (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        resident_id         UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        unit_id             UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        relationship_type   VARCHAR(30) NOT NULL DEFAULT 'resident'
                            CHECK (relationship_type IN (
                              'owner','tenant','resident','family_member','representative'
                            )),
        is_primary          BOOLEAN NOT NULL DEFAULT true,
        is_active           BOOLEAN NOT NULL DEFAULT true,
        starts_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at             TIMESTAMPTZ,
        ended_reason        TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT resident_unit_links_window CHECK (
          ends_at IS NULL OR ends_at >= starts_at
        )
      )
    `);

    await client.query(`
      INSERT INTO resident_unit_links
        (property_id, resident_id, unit_id, relationship_type, is_primary,
         is_active, starts_at, ends_at, ended_reason)
      SELECT r.property_id,
             r.id,
             r.unit_id,
             CASE
               WHEN r.resident_type IN ('owner','tenant','family_member') THEN r.resident_type
               ELSE 'resident'
             END,
             true,
             r.is_active,
             r.created_at,
             CASE WHEN r.is_active THEN NULL ELSE r.updated_at END,
             CASE WHEN r.is_active THEN NULL ELSE 'backfilled inactive resident' END
        FROM residents r
       WHERE NOT EXISTS (
         SELECT 1
           FROM resident_unit_links l
          WHERE l.resident_id = r.id
            AND l.unit_id = r.unit_id
       )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_resident_unit_links_active
        ON resident_unit_links(resident_id, unit_id)
        WHERE is_active = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_unit_links_resident
        ON resident_unit_links(resident_id, is_active, starts_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_resident_unit_links_unit
        ON resident_unit_links(property_id, unit_id, is_active)
    `);

    await client.query(`
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS review_required    BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS offboarded_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS offboarding_reason TEXT
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_resident_review
        ON vehicles(property_id, owner_resident_id, review_required)
        WHERE owner_resident_id IS NOT NULL
    `);
  },
};
