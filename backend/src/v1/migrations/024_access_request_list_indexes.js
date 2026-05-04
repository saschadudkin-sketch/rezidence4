'use strict';

// platform-v1 property-DB migration 024 — access request list query indexes.
//
// The v1 list endpoint filters by resident/status and orders by created_at.
// Keep these as a forward-only migration so existing property DBs receive the
// same planner support as fresh installs.

module.exports = {
  id: 'v1_024_access_request_list_indexes',
  async up(client) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_resident_created
        ON access_requests(created_by_resident_id, created_at DESC)
        WHERE created_by_resident_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_status_created
        ON access_requests(status, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_created
        ON access_requests(created_at DESC)
    `);
  },
};
