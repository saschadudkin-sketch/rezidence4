'use strict';

// Forward hardening for v1_052_trusted_visitors.
// Service code scopes trusted visitors by (property_id, resident_id); these
// constraints make the same tenant boundary explicit at the database level.

module.exports = {
  id: 'v1_057_trusted_visitor_scope_constraints',
  async up(client) {
    await client.query(`
      UPDATE trusted_visitors tv
         SET property_id = r.property_id,
             is_active = false,
             updated_at = NOW()
        FROM residents r
       WHERE tv.resident_id = r.id
         AND tv.property_id <> r.property_id
    `);

    await client.query(`
      UPDATE access_requests ar
         SET trusted_visitor_id = NULL,
             updated_at = NOW()
        FROM trusted_visitors tv
       WHERE ar.trusted_visitor_id = tv.id
         AND ar.property_id <> tv.property_id
    `);

    await client.query(`
      ALTER TABLE residents
        DROP CONSTRAINT IF EXISTS residents_id_property_unique,
        ADD CONSTRAINT residents_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE trusted_visitors
        DROP CONSTRAINT IF EXISTS trusted_visitors_id_property_unique,
        ADD CONSTRAINT trusted_visitors_id_property_unique UNIQUE (id, property_id)
    `);

    await client.query(`
      ALTER TABLE trusted_visitors
        DROP CONSTRAINT IF EXISTS trusted_visitors_resident_property_fk,
        ADD CONSTRAINT trusted_visitors_resident_property_fk
        FOREIGN KEY (resident_id, property_id)
        REFERENCES residents(id, property_id)
        ON DELETE CASCADE
    `);

    await client.query(`
      ALTER TABLE access_requests
        DROP CONSTRAINT IF EXISTS access_requests_trusted_visitor_property_fk,
        ADD CONSTRAINT access_requests_trusted_visitor_property_fk
        FOREIGN KEY (trusted_visitor_id, property_id)
        REFERENCES trusted_visitors(id, property_id)
        ON DELETE SET NULL (trusted_visitor_id)
    `);
  },
};
