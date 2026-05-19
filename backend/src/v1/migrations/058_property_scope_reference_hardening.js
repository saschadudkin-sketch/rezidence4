'use strict';

// Forward hardening for property-owned references that are read through
// scoped detail endpoints. The original single-column FKs preserve entity
// existence; these composite constraints make same-property ownership explicit.

module.exports = {
  id: 'v1_058_property_scope_reference_hardening',
  async up(client) {
    await client.query(`
      UPDATE access_requests ar
         SET vehicle_id = NULL,
             updated_at = NOW()
        FROM vehicles v
       WHERE ar.vehicle_id = v.id
         AND ar.property_id <> v.property_id
    `);

    await client.query(`
      UPDATE passes p
         SET access_request_id = NULL
        FROM access_requests ar
       WHERE p.access_request_id = ar.id
         AND p.property_id <> ar.property_id
    `);

    await client.query(`
      UPDATE visit_logs_v2 vl
         SET pass_id = NULL
        FROM passes p
       WHERE vl.pass_id = p.id
         AND vl.property_id <> p.property_id
    `);

    await client.query(`
      UPDATE access_incidents ai
         SET related_pass_id = NULL
        FROM passes p
       WHERE ai.related_pass_id = p.id
         AND ai.property_id <> p.property_id
    `);

    await client.query(`
      UPDATE access_incidents ai
         SET related_vehicle_id = NULL
        FROM vehicles v
       WHERE ai.related_vehicle_id = v.id
         AND ai.property_id <> v.property_id
    `);

    await client.query(`
      UPDATE notification_log_v2 nl
         SET outbox_id = NULL
        FROM notifications_outbox no
       WHERE nl.outbox_id = no.id
         AND nl.property_id <> no.property_id
    `);

    await client.query(`
      ALTER TABLE vehicles
        DROP CONSTRAINT IF EXISTS vehicles_id_property_unique,
        ADD CONSTRAINT vehicles_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_id_property_unique,
        ADD CONSTRAINT access_requests_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE passes
        DROP CONSTRAINT IF EXISTS passes_id_property_unique,
        ADD CONSTRAINT passes_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE notifications_outbox
        DROP CONSTRAINT IF EXISTS notifications_outbox_id_property_unique,
        ADD CONSTRAINT notifications_outbox_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_vehicle_property_fk,
        ADD CONSTRAINT access_requests_vehicle_property_fk
        FOREIGN KEY (vehicle_id, property_id)
        REFERENCES vehicles(id, property_id)
        ON DELETE SET NULL (vehicle_id)
    `);

    await client.query(`
      ALTER TABLE passes
        DROP CONSTRAINT IF EXISTS passes_access_request_property_fk,
        ADD CONSTRAINT passes_access_request_property_fk
        FOREIGN KEY (access_request_id, property_id)
        REFERENCES access_requests(id, property_id)
        ON DELETE SET NULL (access_request_id)
    `);

    await client.query(`
      ALTER TABLE visit_logs_v2
        DROP CONSTRAINT IF EXISTS visit_logs_v2_pass_property_fk,
        ADD CONSTRAINT visit_logs_v2_pass_property_fk
        FOREIGN KEY (pass_id, property_id)
        REFERENCES passes(id, property_id)
        ON DELETE SET NULL (pass_id)
    `);

    await client.query(`
      ALTER TABLE access_incidents
        DROP CONSTRAINT IF EXISTS access_incidents_related_pass_property_fk,
        ADD CONSTRAINT access_incidents_related_pass_property_fk
        FOREIGN KEY (related_pass_id, property_id)
        REFERENCES passes(id, property_id)
        ON DELETE SET NULL (related_pass_id)
    `);

    await client.query(`
      ALTER TABLE access_incidents
        DROP CONSTRAINT IF EXISTS access_incidents_related_vehicle_property_fk,
        ADD CONSTRAINT access_incidents_related_vehicle_property_fk
        FOREIGN KEY (related_vehicle_id, property_id)
        REFERENCES vehicles(id, property_id)
        ON DELETE SET NULL (related_vehicle_id)
    `);

    await client.query(`
      ALTER TABLE notification_log_v2
        DROP CONSTRAINT IF EXISTS notification_log_v2_outbox_property_fk,
        ADD CONSTRAINT notification_log_v2_outbox_property_fk
        FOREIGN KEY (outbox_id, property_id)
        REFERENCES notifications_outbox(id, property_id)
        ON DELETE SET NULL (outbox_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_property_id
        ON vehicles(property_id, id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_property_id
        ON access_requests(property_id, id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_passes_property_id
        ON passes(property_id, id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_outbox_property_id
        ON notifications_outbox(property_id, id)
    `);
  },
};
