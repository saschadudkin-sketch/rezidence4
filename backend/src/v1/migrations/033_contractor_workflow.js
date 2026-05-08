'use strict';

// platform-v1 property-DB migration 033 — contractor workflow runtime fields.
//
// DH-29 builds on the DH-27 execution lifecycle but keeps contractor identity
// explicit: request assignment still uses legacy assigned_to_* columns for
// compatibility, while these UUID columns bind the work item to v1
// contractor_users / contractor_companies and make company-level reporting
// possible.

module.exports = {
  id: 'v1_033_contractor_workflow',
  async up(client) {
    await client.query(`
      ALTER TABLE requests
        ADD COLUMN IF NOT EXISTS assigned_contractor_user_id UUID
          REFERENCES contractor_users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS assigned_contractor_company_id UUID
          REFERENCES contractor_companies(id) ON DELETE SET NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS request_contractor_events (
        id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id                     TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        contractor_user_id             UUID REFERENCES contractor_users(id) ON DELETE SET NULL,
        contractor_company_id          UUID REFERENCES contractor_companies(id) ON DELETE SET NULL,
        contractor_uid                 TEXT REFERENCES users(uid) ON DELETE SET NULL,
        actor_uid                      TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
        actor_name                     TEXT,
        actor_role                     TEXT,
        event_type                     VARCHAR(40) NOT NULL
                                       CHECK (event_type IN (
                                         'assigned','started','resumed',
                                         'waiting_parts','resolved'
                                       )),
        from_status                    TEXT,
        to_status                      TEXT NOT NULL,
        metadata                       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_contractor_events_request
        ON request_contractor_events(request_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_contractor_events_contractor
        ON request_contractor_events(contractor_user_id, event_type, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_contractor_events_company
        ON request_contractor_events(contractor_company_id, event_type, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_contractor_queue
        ON requests(
          assigned_to_role,
          assigned_contractor_user_id,
          assigned_contractor_company_id,
          status,
          created_at DESC
        )
        WHERE deleted_at IS NULL
    `);
  },
};
