'use strict';

// platform-v1 property-DB migration 027 — access zones and access points.
//
// DH-06 turns planned checkpoint/gate data into durable runtime topology.
// Existing access requests, passes and visit logs already carry nullable
// zone/point columns; this migration adds FK-ready source tables.

function addConstraintIfMissing(name, sql) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${name}'
      ) THEN
        ${sql}
      END IF;
    END $$;
  `;
}

module.exports = {
  id: 'v1_027_access_topology',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_zones (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id   UUID NOT NULL,
        building_id   UUID REFERENCES buildings(id) ON DELETE SET NULL,
        name          VARCHAR(100) NOT NULL,
        zone_type     VARCHAR(30) NOT NULL
                      CHECK (zone_type IN (
                        'perimeter','checkpoint','residential_entry','parking',
                        'guest_parking','resident_parking','public_area',
                        'technical_area','service_area','street','sector'
                      )),
        description   TEXT,
        is_active     BOOLEAN NOT NULL DEFAULT true,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT access_zones_property_id_unique UNIQUE (property_id, id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS access_points (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        zone_id                UUID NOT NULL,
        name                   VARCHAR(100) NOT NULL,
        point_type             VARCHAR(30) NOT NULL
                               CHECK (point_type IN (
                                 'gate','barrier','door','turnstile',
                                 'wicket','intercom','checkpoint','service_gate'
                               )),
        provider               VARCHAR(50),
        provider_external_id   TEXT,
        description            TEXT,
        is_active              BOOLEAN NOT NULL DEFAULT true,
        sort_order             INTEGER NOT NULL DEFAULT 0,
        metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT access_points_property_id_unique UNIQUE (property_id, id),
        CONSTRAINT access_points_zone_property_fk
          FOREIGN KEY (property_id, zone_id)
          REFERENCES access_zones(property_id, id)
          ON DELETE RESTRICT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_zones_property_active
        ON access_zones(property_id, is_active, sort_order, name)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_access_zones_property_name_active
        ON access_zones(property_id, LOWER(name))
        WHERE is_active = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_zones_building
        ON access_zones(building_id)
        WHERE building_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_points_property_active
        ON access_points(property_id, is_active, sort_order, name)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_points_zone
        ON access_points(property_id, zone_id, is_active)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_points_provider
        ON access_points(provider, provider_external_id)
        WHERE provider IS NOT NULL AND provider_external_id IS NOT NULL
    `);

    await client.query(addConstraintIfMissing(
      'access_requests_target_zone_fk',
      `ALTER TABLE access_requests
         ADD CONSTRAINT access_requests_target_zone_fk
         FOREIGN KEY (property_id, target_zone_id)
         REFERENCES access_zones(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));

    await client.query(addConstraintIfMissing(
      'access_requests_target_point_fk',
      `ALTER TABLE access_requests
         ADD CONSTRAINT access_requests_target_point_fk
         FOREIGN KEY (property_id, target_point_id)
         REFERENCES access_points(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));

    await client.query(addConstraintIfMissing(
      'passes_zone_fk',
      `ALTER TABLE passes
         ADD CONSTRAINT passes_zone_fk
         FOREIGN KEY (property_id, zone_id)
         REFERENCES access_zones(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));

    await client.query(addConstraintIfMissing(
      'passes_point_fk',
      `ALTER TABLE passes
         ADD CONSTRAINT passes_point_fk
         FOREIGN KEY (property_id, point_id)
         REFERENCES access_points(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));

    await client.query(addConstraintIfMissing(
      'visit_logs_v2_access_point_fk',
      `ALTER TABLE visit_logs_v2
         ADD CONSTRAINT visit_logs_v2_access_point_fk
         FOREIGN KEY (property_id, access_point_id)
         REFERENCES access_points(property_id, id)
         ON DELETE RESTRICT
         NOT VALID;`,
    ));
  },
};
