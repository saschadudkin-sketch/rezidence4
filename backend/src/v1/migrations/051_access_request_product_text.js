'use strict';

// Access rollout Phase 3 — stable resident/guest/guard UX text fields.
// These are product contract fields, not metadata: public pass uses
// guest_instructions, guard console uses guard_notes.

module.exports = {
  id: 'v1_051_access_request_product_text',
  async up(client) {
    await client.query(`
      ALTER TABLE access_requests
        ADD COLUMN IF NOT EXISTS guest_instructions TEXT,
        ADD COLUMN IF NOT EXISTS guard_notes TEXT,
        ADD COLUMN IF NOT EXISTS share_delivery_channels JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_share_delivery_channels_check
    `);

    await client.query(`
      ALTER TABLE access_requests
        ADD CONSTRAINT access_requests_share_delivery_channels_check
        CHECK (jsonb_typeof(share_delivery_channels) = 'array')
    `);
  },
};
