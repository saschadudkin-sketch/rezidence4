'use strict';

// platform-v1 property-DB migration 032 — technician workflow runtime fields.
//
// DH-27 keeps service requests on the existing `requests` compatibility table,
// but adds the execution fields and event stream needed by technician queues,
// waiting states, resolution output and KPI reporting.

module.exports = {
  id: 'v1_032_technician_workflow',
  async up(client) {
    await client.query(`
      ALTER TABLE requests
        ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolution_note TEXT,
        ADD COLUMN IF NOT EXISTS requires_follow_up BOOLEAN NOT NULL DEFAULT false
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS request_technician_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        technician_uid  TEXT REFERENCES users(uid) ON DELETE SET NULL,
        actor_uid       TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
        actor_name      TEXT,
        actor_role      TEXT,
        event_type      VARCHAR(40) NOT NULL
                        CHECK (event_type IN (
                          'claimed','started','resumed',
                          'waiting_resident','waiting_parts','resolved'
                        )),
        from_status     TEXT,
        to_status       TEXT NOT NULL,
        metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_technician_events_request
        ON request_technician_events(request_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_technician_events_technician
        ON request_technician_events(technician_uid, event_type, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_technician_queue
        ON requests(assigned_to_role, assigned_to_uid, status, created_at DESC)
        WHERE deleted_at IS NULL
    `);
  },
};
