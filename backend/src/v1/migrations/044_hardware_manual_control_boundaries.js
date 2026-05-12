'use strict';

// DH-59 — hardware registry manual-control boundaries.
//
// DH-41 introduced vendor-neutral hardware mapping.  This migration makes that
// map operationally useful for production by documenting manual-control policy,
// fail-safe behavior, maintenance state and every manual action taken.

function addConstraintIfMissing(name, sql) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${name}'
      ) THEN
        ${sql}
      END IF;
    END $$;
  `;
}

module.exports = {
  id: 'v1_044_hardware_manual_control_boundaries',
  async up(client) {
    await client.query(`
      ALTER TABLE skud_hardware_devices
        ADD COLUMN IF NOT EXISTS manual_control_policy VARCHAR(30) NOT NULL DEFAULT 'guard_allowed',
        ADD COLUMN IF NOT EXISTS manual_action_requires_reason BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS manual_action_requires_approval BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS fail_safe_mode VARCHAR(30) NOT NULL DEFAULT 'fail_closed',
        ADD COLUMN IF NOT EXISTS maintenance_status VARCHAR(30) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS last_manual_action_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_manual_action_by_uid TEXT
    `);

    await client.query(addConstraintIfMissing(
      'skud_hardware_devices_manual_policy_check',
      `ALTER TABLE skud_hardware_devices
         ADD CONSTRAINT skud_hardware_devices_manual_policy_check
         CHECK (manual_control_policy IN (
           'guard_allowed','admin_only','provider_only','prohibited'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'skud_hardware_devices_fail_safe_check',
      `ALTER TABLE skud_hardware_devices
         ADD CONSTRAINT skud_hardware_devices_fail_safe_check
         CHECK (fail_safe_mode IN (
           'fail_closed','fail_open_guarded','provider_default','manual_guard'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'skud_hardware_devices_maintenance_status_check',
      `ALTER TABLE skud_hardware_devices
         ADD CONSTRAINT skud_hardware_devices_maintenance_status_check
         CHECK (maintenance_status IN ('normal','maintenance','out_of_service'));`,
    ));

    await client.query(`
      CREATE TABLE IF NOT EXISTS hardware_manual_control_events (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        hardware_device_id  UUID NOT NULL,
        action              VARCHAR(40) NOT NULL
                            CHECK (action IN (
                              'manual_open','manual_close','manual_block','manual_unblock',
                              'manual_reset','mark_degraded','mark_restored'
                            )),
        actor_uid           TEXT NOT NULL,
        actor_role          TEXT,
        reason              TEXT NOT NULL,
        decision_source     VARCHAR(30) NOT NULL DEFAULT 'guard'
                            CHECK (decision_source IN ('guard','admin','incident','provider_fallback')),
        metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT hardware_manual_control_events_reason_not_blank
          CHECK (length(trim(reason)) > 0),
        CONSTRAINT hardware_manual_control_events_device_fk
          FOREIGN KEY (property_id, hardware_device_id)
          REFERENCES skud_hardware_devices(property_id, id)
          ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hardware_manual_events_device
        ON hardware_manual_control_events(property_id, hardware_device_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hardware_manual_events_action
        ON hardware_manual_control_events(property_id, action, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_hardware_devices_manual_boundary
        ON skud_hardware_devices(property_id, device_class, manual_control_policy, fail_safe_mode, maintenance_status)
    `);
  },
};
