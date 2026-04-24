'use strict';

// platform-v1 property-DB migration 009 — access_requests (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/access-requests-spec.md §2.
//
// Формальная заявка на доступ — разделение legacy-монолита `requests`
// (который смешивал access и service-типы).  Service-часть пойдёт в
// `service_requests` в Фазе 6; здесь только access.
//
// Инварианты:
//   - CHECK «ровно один created_by_*_id заполнен, согласованный с created_by_type»
//   - Status enum пинается CHECK'ом (legacy держал TEXT с 14 значениями)
//   - target_zone_id/target_point_id — nullable UUID без FK в v1
//     (таблицы access_zones/access_points появятся пост-релиз)
//
// Индексы ориентированы на (а) список заявок property_admin, (б) свои
// заявки резидента, (в) окно времени для batch-expiry.

module.exports = {
  id: 'v1_009_access_requests',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                     UUID NOT NULL,
        created_by_type                 VARCHAR(20) NOT NULL
                                        CHECK (created_by_type IN ('resident','staff','contractor')),
        created_by_resident_id          UUID REFERENCES residents(id) ON DELETE RESTRICT,
        created_by_staff_id             UUID REFERENCES staff_users(id) ON DELETE RESTRICT,
        created_by_contractor_user_id   UUID REFERENCES contractor_users(id) ON DELETE RESTRICT,
        request_type                    VARCHAR(40) NOT NULL
                                        CHECK (request_type IN (
                                          'guest_access','vehicle_access','contractor_access',
                                          'courier_access','service_access','temporary_resident_access'
                                        )),
        visitor_name                    TEXT,
        visitor_phone                   TEXT,
        vehicle_id                      UUID REFERENCES vehicles(id) ON DELETE RESTRICT,
        target_zone_id                  UUID,
        target_point_id                 UUID,
        target_unit_id                  UUID REFERENCES units(id) ON DELETE RESTRICT,
        reason                          TEXT,
        starts_at                       TIMESTAMPTZ NOT NULL,
        ends_at                         TIMESTAMPTZ NOT NULL,
        status                          VARCHAR(20) NOT NULL DEFAULT 'new'
                                        CHECK (status IN (
                                          'new','pending_approval','approved','rejected','cancelled','expired'
                                        )),
        approval_required               BOOLEAN NOT NULL DEFAULT true,
        approved_at                     TIMESTAMPTZ,
        rejected_at                     TIMESTAMPTZ,
        cancelled_at                    TIMESTAMPTZ,
        created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT access_requests_creator_exclusive CHECK (
          (created_by_type = 'resident'
             AND created_by_resident_id IS NOT NULL
             AND created_by_staff_id IS NULL
             AND created_by_contractor_user_id IS NULL)
          OR (created_by_type = 'staff'
             AND created_by_resident_id IS NULL
             AND created_by_staff_id IS NOT NULL
             AND created_by_contractor_user_id IS NULL)
          OR (created_by_type = 'contractor'
             AND created_by_resident_id IS NULL
             AND created_by_staff_id IS NULL
             AND created_by_contractor_user_id IS NOT NULL)
        ),
        CONSTRAINT access_requests_window CHECK (ends_at > starts_at)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_property_status
        ON access_requests(property_id, status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_creator_resident
        ON access_requests(created_by_resident_id)
        WHERE created_by_resident_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_vehicle
        ON access_requests(vehicle_id) WHERE vehicle_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_requests_window
        ON access_requests(property_id, starts_at, ends_at)
        WHERE status IN ('pending_approval','approved')
    `);
  },
};
