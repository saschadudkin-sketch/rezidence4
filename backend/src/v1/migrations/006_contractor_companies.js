'use strict';

// platform-v1 property-DB migration 006 — contractor_companies (Фаза 2).
// Spec: docs/product/specs/platform-v1/contractors-spec.md §2.
//
// Contractor companies represent external legal entities with recurring
// access to the property — couriers, cleaning firms, maintenance providers.
// They're separated from staff_users because the access contract is with
// the company, not an individual: terminate the contract → all their
// contractor_users lose pass issuance.

module.exports = {
  id: 'v1_006_contractor_companies',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contractor_companies (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id     UUID NOT NULL,
        name            TEXT NOT NULL,
        contact_name    TEXT,
        contact_phone   TEXT,
        contact_email   TEXT,
        status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','terminated')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contractor_companies_property_status
        ON contractor_companies(property_id, status)
    `);

    // Soft unique on name inside a single property — duplicate names would
    // confuse concierges picking from a dropdown.  Case-insensitive so
    // "Cleaning Co" and "cleaning co" collide.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_companies_property_name
        ON contractor_companies(property_id, LOWER(name))
    `);
  },
};
