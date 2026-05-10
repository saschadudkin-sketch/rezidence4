'use strict';

// platform-v1 property-DB migration 037 — SKUD provider list expansion.
//
// Extends the neutral provider registry for common Russia deployments while
// keeping vendor behavior in adapters and config_json.

module.exports = {
  id: 'v1_037_skud_russia_provider_wave',
  async up(client) {
    await client.query(`
      ALTER TABLE skud_provider_configs
        DROP CONSTRAINT IF EXISTS skud_provider_configs_provider_check
    `);

    await client.query(`
      ALTER TABLE skud_provider_configs
        ADD CONSTRAINT skud_provider_configs_provider_check
          CHECK (provider IN (
            'bolid','generic','hikvision','ironlogic','parsec',
            'perco','rusguard','sigur','trassir_access'
          ))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_skud_provider_configs_provider_health
        ON skud_provider_configs(property_id, provider, health_status)
    `);
  },
};
