'use strict';

// platform-v1 property-DB migration 008 — vehicles (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/vehicles-spec.md §2.
//
// First-class транспортное средство в рамках property. Консолидирует три
// legacy-источника (`requests.car_plate`, `blacklist.car_plate`, отсутствующий
// whitelist) в единую таблицу.
//
// Инварианты, enforce'имые на уровне БД:
//   - UNIQUE (property_id, plate_number): нельзя дублировать номер в одном property
//   - CHECK «ровно один owner_*_id заполнен ИЛИ все NULL при owner_type='guest'»
//   - CHECK «не может быть одновременно в whitelist и blacklist»
// `plate_number` хранится уже нормализованным (см. vehicles-spec §3 `normalizePlate`),
// нормализация — ответственность сервиса, БД хранит as-is.

module.exports = {
  id: 'v1_008_vehicles',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                 UUID NOT NULL,
        owner_type                  VARCHAR(20) NOT NULL
                                    CHECK (owner_type IN ('resident','staff','contractor','guest')),
        owner_resident_id           UUID REFERENCES residents(id) ON DELETE RESTRICT,
        owner_staff_id              UUID REFERENCES staff_users(id) ON DELETE RESTRICT,
        owner_contractor_user_id    UUID REFERENCES contractor_users(id) ON DELETE RESTRICT,
        plate_number                VARCHAR(20) NOT NULL,
        vehicle_type                VARCHAR(20) NOT NULL DEFAULT 'car'
                                    CHECK (vehicle_type IN ('car','motorcycle','truck','service_vehicle')),
        color                       VARCHAR(40),
        brand                       VARCHAR(60),
        model                       VARCHAR(60),
        is_whitelisted              BOOLEAN NOT NULL DEFAULT false,
        is_blacklisted              BOOLEAN NOT NULL DEFAULT false,
        notes                       TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT vehicles_owner_exclusive CHECK (
          (owner_type = 'guest'
             AND owner_resident_id IS NULL
             AND owner_staff_id IS NULL
             AND owner_contractor_user_id IS NULL)
          OR (owner_type = 'resident'
             AND owner_resident_id IS NOT NULL
             AND owner_staff_id IS NULL
             AND owner_contractor_user_id IS NULL)
          OR (owner_type = 'staff'
             AND owner_resident_id IS NULL
             AND owner_staff_id IS NOT NULL
             AND owner_contractor_user_id IS NULL)
          OR (owner_type = 'contractor'
             AND owner_resident_id IS NULL
             AND owner_staff_id IS NULL
             AND owner_contractor_user_id IS NOT NULL)
        ),
        CONSTRAINT vehicles_flags_exclusive CHECK (
          NOT (is_whitelisted = true AND is_blacklisted = true)
        )
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_property_plate
        ON vehicles(property_id, plate_number)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_blacklisted
        ON vehicles(property_id) WHERE is_blacklisted = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_whitelisted
        ON vehicles(property_id) WHERE is_whitelisted = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vehicles_owner_resident
        ON vehicles(owner_resident_id) WHERE owner_resident_id IS NOT NULL
    `);
  },
};
