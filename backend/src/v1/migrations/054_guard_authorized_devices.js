'use strict';

// Access rollout Phase 7 — guard authorized devices.
//
// Stores per-property checkpoint device allow-list entries used to gate
// sensitive guard actions when the `guard_authorized_devices` feature flag is
// enabled.

module.exports = {
  id: 'v1_054_guard_authorized_devices',
  async up(client) {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_users_property_id
        ON staff_users(property_id, id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS guard_authorized_devices (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id          UUID NOT NULL,
        access_point_id      UUID,
        staff_user_id        UUID,
        device_fingerprint   TEXT NOT NULL,
        label                VARCHAR(120) NOT NULL,
        status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CONSTRAINT guard_authorized_devices_status_check
                             CHECK (status IN ('pending','active','revoked')),
        last_seen_at         TIMESTAMPTZ,
        approved_by_staff_id UUID,
        approved_at          TIMESTAMPTZ,
        revoked_at           TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT guard_authorized_devices_label_not_blank
          CHECK (length(trim(label)) > 0),
        CONSTRAINT guard_authorized_devices_fingerprint_not_blank
          CHECK (length(trim(device_fingerprint)) > 0),
        CONSTRAINT guard_authorized_devices_access_point_fk
          FOREIGN KEY (property_id, access_point_id)
          REFERENCES access_points(property_id, id)
          ON DELETE SET NULL,
        CONSTRAINT guard_authorized_devices_staff_fk
          FOREIGN KEY (property_id, staff_user_id)
          REFERENCES staff_users(property_id, id)
          ON DELETE SET NULL (staff_user_id),
        CONSTRAINT guard_authorized_devices_approved_by_staff_fk
          FOREIGN KEY (approved_by_staff_id)
          REFERENCES staff_users(id)
          ON DELETE SET NULL
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_guard_authorized_devices_fingerprint
        ON guard_authorized_devices(property_id, device_fingerprint)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guard_authorized_devices_property_status
        ON guard_authorized_devices(property_id, status, updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guard_authorized_devices_access_point
        ON guard_authorized_devices(property_id, access_point_id, status)
        WHERE access_point_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guard_authorized_devices_staff
        ON guard_authorized_devices(property_id, staff_user_id, status)
        WHERE staff_user_id IS NOT NULL
    `);
  },
};
