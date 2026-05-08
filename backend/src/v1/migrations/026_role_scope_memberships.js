'use strict';

// platform-v1 property-DB migration 026 — role/scope memberships.
//
// DH-03 bridge: current v1 has profile tables and a capability catalog, but
// no durable record that says "this actor has this role at this scope".
// This table is intentionally property-local: property DB remains the source
// of truth for operational actors. Platform / MC admins are handled by the
// platform DB and can still be represented here when mirrored into a property.

module.exports = {
  id: 'v1_026_role_scope_memberships',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_scope_memberships (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id            UUID NOT NULL,
        resident_id            UUID REFERENCES residents(id) ON DELETE CASCADE,
        staff_user_id          UUID REFERENCES staff_users(id) ON DELETE CASCADE,
        contractor_user_id     UUID REFERENCES contractor_users(id) ON DELETE CASCADE,
        role                   VARCHAR(40) NOT NULL
                               CHECK (role IN (
                                 'resident','security','concierge','technician','contractor',
                                 'property_admin','management_company_admin','platform_admin'
                               )),
        scope_level            VARCHAR(30) NOT NULL
                               CHECK (scope_level IN (
                                 'property','building','entrance','floor','unit',
                                 'parking_zone','access_zone','access_point'
                               )),
        scope_id               UUID,
        status                 VARCHAR(20) NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','suspended','revoked','expired')),
        starts_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at                TIMESTAMPTZ,
        created_by_staff_id    UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT role_scope_memberships_subject_exclusive CHECK (
          ((resident_id IS NOT NULL)::int
         + (staff_user_id IS NOT NULL)::int
         + (contractor_user_id IS NOT NULL)::int) = 1
        ),
        CONSTRAINT role_scope_memberships_scope_consistent CHECK (
          (scope_level = 'property' AND scope_id IS NULL)
          OR
          (scope_level <> 'property' AND scope_id IS NOT NULL)
        ),
        CONSTRAINT role_scope_memberships_window CHECK (
          ends_at IS NULL OR ends_at > starts_at
        ),
        CONSTRAINT role_scope_memberships_subject_role CHECK (
          (resident_id IS NOT NULL AND role = 'resident')
          OR
          (contractor_user_id IS NOT NULL AND role = 'contractor')
          OR
          (staff_user_id IS NOT NULL AND role IN (
            'security','concierge','technician','property_admin',
            'management_company_admin','platform_admin'
          ))
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_property_active
        ON role_scope_memberships(property_id, status, role)
        WHERE status = 'active'
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_scope
        ON role_scope_memberships(property_id, scope_level, scope_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_resident
        ON role_scope_memberships(resident_id, status)
        WHERE resident_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_staff
        ON role_scope_memberships(staff_user_id, status)
        WHERE staff_user_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_role_scope_memberships_contractor
        ON role_scope_memberships(contractor_user_id, status)
        WHERE contractor_user_id IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_scope_memberships_resident_active
        ON role_scope_memberships(property_id, resident_id, role, scope_level, COALESCE(scope_id, property_id))
        WHERE resident_id IS NOT NULL AND status = 'active'
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_scope_memberships_staff_active
        ON role_scope_memberships(property_id, staff_user_id, role, scope_level, COALESCE(scope_id, property_id))
        WHERE staff_user_id IS NOT NULL AND status = 'active'
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_scope_memberships_contractor_active
        ON role_scope_memberships(property_id, contractor_user_id, role, scope_level, COALESCE(scope_id, property_id))
        WHERE contractor_user_id IS NOT NULL AND status = 'active'
    `);
  },
};
