'use strict';

// platform-v1 property-DB migration 004 — residents (Фаза 2 People layer).
// Spec: docs/product/specs/platform-v1/residents-spec.md §2.
//
// `external_uid` holds the legacy `users.uid` for objects that will go through
// a data migration in Фаза 7 — it's UNIQUE but nullable because fresh
// residents created after go-live have no legacy counterpart.
//
// `phone` is intentionally NOT UNIQUE: the same person may be a resident on
// multiple properties inside the same UK (spec §2).  Uniqueness is enforced
// per-property via `(property_id, phone)` when we accept the resident in
// Фаза 7 — but even then only as a soft-uniqueness in service layer to
// tolerate shared family phones.

module.exports = {
  id: 'v1_004_residents',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS residents (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_uid      TEXT UNIQUE,
        property_id       UUID NOT NULL,
        unit_id           UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        full_name         TEXT NOT NULL,
        phone             TEXT NOT NULL,
        email             TEXT,
        role              VARCHAR(20) NOT NULL DEFAULT 'resident',
        resident_type     VARCHAR(20) NOT NULL DEFAULT 'owner'
                          CHECK (resident_type IN ('owner','tenant','family_member')),
        is_active         BOOLEAN NOT NULL DEFAULT true,
        consent_given_at  TIMESTAMPTZ,
        consent_version   VARCHAR(20),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_residents_property_unit
        ON residents(property_id, unit_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_residents_phone
        ON residents(phone)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_residents_active
        ON residents(property_id, is_active)
    `);
  },
};
