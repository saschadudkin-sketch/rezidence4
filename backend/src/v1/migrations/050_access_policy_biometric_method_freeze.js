'use strict';

// platform-v1 property-DB migration 050 — biometric access methods freeze.
//
// Product source of truth explicitly keeps biometric identity matching out of
// the approved access core. Preserve any historical rows as inactive manual
// review records, then enforce the approved method set at the DB layer.

module.exports = {
  id: 'v1_050_access_policy_biometric_method_freeze',
  async up(client) {
    await client.query(`
      UPDATE access_policies
         SET access_method = 'manual',
             is_active = false,
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'disabled_access_method', 'face',
                    'disabled_reason', 'biometric identity matching is not approved for access core'
                  ),
             updated_at = NOW()
       WHERE access_method = 'face'
    `);

    await client.query(`
      ALTER TABLE access_policies
        DROP CONSTRAINT IF EXISTS access_policies_access_method_check
    `);

    await client.query(`
      ALTER TABLE access_policies
        ADD CONSTRAINT access_policies_access_method_check
        CHECK (access_method IN (
          'qr','manual','plate','ble','card','pin'
        ))
    `);
  },
};
