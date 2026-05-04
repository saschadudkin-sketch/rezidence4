'use strict';

// platform-v1 property-DB migration 023 — actor external_uid bridge.
//
// residents.external_uid already exists from migration 004.  Several v1
// services also resolve staff by legacy users.uid, but staff_users and
// contractor_users did not expose a matching column on fresh installs.

module.exports = {
  id: 'v1_023_actor_external_uid',
  async up(client) {
    await client.query(`
      ALTER TABLE staff_users
        ADD COLUMN IF NOT EXISTS external_uid TEXT
    `);

    await client.query(`
      ALTER TABLE contractor_users
        ADD COLUMN IF NOT EXISTS external_uid TEXT
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_users_external_uid
        ON staff_users(external_uid)
        WHERE external_uid IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_users_external_uid
        ON contractor_users(external_uid)
        WHERE external_uid IS NOT NULL
    `);
  },
};
