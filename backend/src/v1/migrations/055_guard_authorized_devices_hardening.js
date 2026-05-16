'use strict';

// Access rollout Phase 7 hardening.
//
// Forward-fix for environments where v1_054 was already applied:
// - add pending approval lifecycle fields;
// - enforce tenant-scoped staff linkage for new rows;
// - hash already-stored device fingerprints so the DB no longer keeps the
//   replay credential in clear text.

module.exports = {
  id: 'v1_055_guard_authorized_devices_hardening',
  async up(client) {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_users_property_id
        ON staff_users(property_id, id)
    `);

    await client.query(`
      ALTER TABLE guard_authorized_devices
        ADD COLUMN IF NOT EXISTS approved_by_staff_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE guard_authorized_devices
        DROP CONSTRAINT IF EXISTS guard_authorized_devices_status_check,
        ALTER COLUMN status SET DEFAULT 'pending',
        ADD CONSTRAINT guard_authorized_devices_status_check
          CHECK (status IN ('pending','active','revoked'))
    `);

    await client.query(`
      ALTER TABLE guard_authorized_devices
        DROP CONSTRAINT IF EXISTS guard_authorized_devices_staff_fk
    `);

    await client.query(`
      ALTER TABLE guard_authorized_devices
        ADD CONSTRAINT guard_authorized_devices_staff_fk
          FOREIGN KEY (property_id, staff_user_id)
          REFERENCES staff_users(property_id, id)
          ON DELETE SET NULL (staff_user_id)
          NOT VALID
    `);

    await client.query(`
      UPDATE guard_authorized_devices
         SET device_fingerprint = encode(digest('guard-device:v1:' || device_fingerprint, 'sha256'), 'hex'),
             updated_at = NOW()
       WHERE device_fingerprint !~ '^[0-9a-f]{64}$'
    `);
  },
};
