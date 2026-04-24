'use strict';

// platform-v1 property-DB migration 005 — staff_users (Фаза 2 People layer).
// Spec: docs/product/specs/platform-v1/staff-users-spec.md §2.
//
// Split-out from legacy `users` — staff is a distinct lifecycle from
// residents (capability-flags, email-based identity, no consent field).
// role CHECK is pinned to the four operational roles; specialization is
// only meaningful for technicians but we keep it nullable everywhere so
// that role transitions stay non-destructive.

module.exports = {
  id: 'v1_005_staff_users',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id               UUID NOT NULL,
        full_name                 TEXT NOT NULL,
        phone                     TEXT,
        email                     TEXT NOT NULL,
        role                      VARCHAR(30) NOT NULL
                                  CHECK (role IN ('security','concierge','technician','property_admin')),
        specialization            VARCHAR(30)
                                  CHECK (specialization IS NULL
                                         OR specialization IN ('plumbing','electric','cleaning','general')),
        is_active                 BOOLEAN NOT NULL DEFAULT true,
        can_view_resident_phone   BOOLEAN NOT NULL DEFAULT false,
        can_assign_requests       BOOLEAN NOT NULL DEFAULT false,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_users_property_email
        ON staff_users(property_id, LOWER(email))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_staff_users_role
        ON staff_users(property_id, role) WHERE is_active = true
    `);
  },
};
