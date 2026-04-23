'use strict';

// platform-v1 property-DB migration 007 — contractor_users (Фаза 2).
// Spec: docs/product/specs/platform-v1/contractors-spec.md §2.
//
// Individual contractor employees.  access_expires_at lets property_admin
// grant e.g. a 3-month window without soft-deleting the row — the service
// layer refuses pass issuance past the expiry, but history stays intact.
// FK on contractor_company_id is RESTRICT so deleting a company that still
// has employees is an explicit two-step action.

module.exports = {
  id: 'v1_007_contractor_users',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contractor_users (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_company_id   UUID NOT NULL REFERENCES contractor_companies(id) ON DELETE RESTRICT,
        property_id             UUID NOT NULL,
        full_name               TEXT NOT NULL,
        phone                   TEXT,
        email                   TEXT,
        specialization          VARCHAR(30),
        is_active               BOOLEAN NOT NULL DEFAULT true,
        access_expires_at       TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contractor_users_company
        ON contractor_users(contractor_company_id) WHERE is_active = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contractor_users_property_active
        ON contractor_users(property_id, is_active)
    `);

    // Partial index for expiry queries — only care about not-yet-expired
    // rows during daily access checks.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contractor_users_expiry
        ON contractor_users(access_expires_at)
        WHERE is_active = true AND access_expires_at IS NOT NULL
    `);
  },
};
