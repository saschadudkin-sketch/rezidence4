'use strict';

// platform-v1 property-DB migration 029 — service request core.
//
// DH-22 splits operational service/territory/emergency requests from the older
// access-heavy legacy shape while keeping the existing `requests` table as the
// runtime compatibility surface for /api/v1/requests.

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
  id: 'v1_029_service_request_core',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS service_request_categories (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id              UUID NOT NULL,
        code                     VARCHAR(80) NOT NULL,
        name                     VARCHAR(120) NOT NULL,
        domain                   VARCHAR(30) NOT NULL DEFAULT 'service'
                                 CHECK (domain IN (
                                   'access','service','territory',
                                   'emergency','security','contractor'
                                 )),
        target_scope             VARCHAR(30) NOT NULL DEFAULT 'unit'
                                 CHECK (target_scope IN (
                                   'unit','home','access_zone','access_point',
                                   'common_territory','road','service_area'
                                 )),
        priority                 VARCHAR(20) NOT NULL DEFAULT 'normal'
                                 CHECK (priority IN ('low','normal','high','emergency')),
        sla_profile              VARCHAR(30) NOT NULL DEFAULT 'standard'
                                 CHECK (sla_profile IN ('standard','urgent','emergency')),
        first_response_minutes   INTEGER,
        resolution_minutes       INTEGER,
        is_emergency             BOOLEAN NOT NULL DEFAULT false,
        is_active                BOOLEAN NOT NULL DEFAULT true,
        metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT service_request_categories_code_unique UNIQUE (property_id, code),
        CONSTRAINT service_request_categories_sla_positive CHECK (
          (first_response_minutes IS NULL OR first_response_minutes > 0)
          AND (resolution_minutes IS NULL OR resolution_minutes > 0)
        ),
        CONSTRAINT service_request_categories_emergency_profile CHECK (
          is_emergency = false
          OR (priority = 'emergency' AND sla_profile = 'emergency')
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_service_request_categories_active
        ON service_request_categories(property_id, is_active, domain, code)
    `);

    await client.query(`
      ALTER TABLE requests
        ADD COLUMN IF NOT EXISTS request_category_id UUID,
        ADD COLUMN IF NOT EXISTS target_type TEXT,
        ADD COLUMN IF NOT EXISTS target_id UUID,
        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS sla_profile TEXT NOT NULL DEFAULT 'standard',
        ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS emergency_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    `);

    await client.query(addConstraintIfMissing(
      'requests_target_type_check',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_target_type_check
         CHECK (
           target_type IS NULL OR target_type IN (
             'unit','home','access_zone','access_point',
             'common_territory','road','service_area'
           )
         );`,
    ));

    await client.query(addConstraintIfMissing(
      'requests_priority_check',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_priority_check
         CHECK (priority IN ('low','normal','high','emergency'));`,
    ));

    await client.query(addConstraintIfMissing(
      'requests_sla_profile_check',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_sla_profile_check
         CHECK (sla_profile IN ('standard','urgent','emergency'));`,
    ));

    await client.query(addConstraintIfMissing(
      'requests_service_category_fk',
      `ALTER TABLE requests
         ADD CONSTRAINT requests_service_category_fk
         FOREIGN KEY (request_category_id)
         REFERENCES service_request_categories(id)
         ON DELETE SET NULL
         NOT VALID;`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_target
        ON requests(target_type, target_id)
        WHERE target_type IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_priority_status
        ON requests(priority, status, created_at DESC)
        WHERE deleted_at IS NULL
    `);
  },
};
