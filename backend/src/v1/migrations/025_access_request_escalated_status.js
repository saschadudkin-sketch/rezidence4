'use strict';

// platform-v1 property-DB migration 025 — add access_requests.status='escalated'.
//
// Phase 1.1 production-slice state machine requires pending_approval -> escalated
// and escalated -> approved/rejected.  Fresh installs get the enum in 009; this
// forward migration brings existing property DBs to the same contract.

module.exports = {
  id: 'v1_025_access_request_escalated_status',
  async up(client) {
    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_status_check
    `);

    await client.query(`
      ALTER TABLE access_requests
        ADD CONSTRAINT access_requests_status_check
        CHECK (status IN (
          'new','pending_approval','escalated','approved','rejected','cancelled','expired'
        ))
    `);
  },
};
