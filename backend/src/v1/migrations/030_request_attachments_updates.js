'use strict';

// platform-v1 property-DB migration 030 — request attachments and resident updates.
//
// DH-23 adds a resident-visible communication layer for service requests while
// preserving the legacy `requests.photos` and `request_history` compatibility
// fields until a later dedicated service-request table split.

module.exports = {
  id: 'v1_030_request_attachments_updates',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS request_attachments (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id        TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        uploaded_by_uid   TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
        file_url          TEXT NOT NULL,
        file_kind         VARCHAR(20) NOT NULL DEFAULT 'photo'
                          CHECK (file_kind IN ('photo','document','other')),
        visibility        VARCHAR(20) NOT NULL DEFAULT 'resident'
                          CHECK (visibility IN ('resident','internal')),
        metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT request_attachments_file_url_upload_check
          CHECK (file_url LIKE '/uploads/%')
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_attachments_request_visibility
        ON request_attachments(request_id, visibility, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_attachments_uploaded_by
        ON request_attachments(uploaded_by_uid, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS request_updates (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id        TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        actor_uid         TEXT NOT NULL REFERENCES users(uid) ON DELETE RESTRICT,
        actor_name        TEXT,
        actor_role        TEXT,
        body              TEXT NOT NULL,
        visibility        VARCHAR(20) NOT NULL DEFAULT 'resident'
                          CHECK (visibility IN ('resident','internal')),
        attachment_ids    UUID[] NOT NULL DEFAULT '{}'::uuid[],
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT request_updates_body_not_blank
          CHECK (length(btrim(body)) > 0)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_updates_request_visibility
        ON request_updates(request_id, visibility, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_request_updates_actor
        ON request_updates(actor_uid, created_at DESC)
    `);
  },
};
