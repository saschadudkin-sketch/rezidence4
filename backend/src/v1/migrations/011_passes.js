'use strict';

// platform-v1 property-DB migration 011 — passes (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/passes-spec.md §2.
//
// Пропуск — first-class сущность: единичное разрешение на проход/проезд с
// явным subject, окном и статусом.  В legacy пропуск существовал неявно
// как `requests WHERE type IN ('pass','car')`.
//
// Ключевые инварианты:
//   - CHECK: ровно один subject_*_id заполнен, согласованный с subject_type
//   - CHECK: valid_until > valid_from (ненулевое окно)
//   - CHECK: если status='revoked' → revoked_at IS NOT NULL (аудит обязателен)
//   - zone_id/point_id/policy_id — nullable UUID без FK, активируются пост-релиз
//     (см. passes-spec §7.3)
//
// access_request_id — nullable: пасс может быть выдан напрямую (staff/contractor
// onboarding без promo-заявки).

module.exports = {
  id: 'v1_011_passes',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS passes (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                     UUID NOT NULL,
        access_request_id               UUID REFERENCES access_requests(id) ON DELETE SET NULL,
        pass_type                       VARCHAR(30) NOT NULL
                                        CHECK (pass_type IN (
                                          'guest','vehicle','resident','staff',
                                          'contractor','courier','service','emergency'
                                        )),
        subject_type                    VARCHAR(20) NOT NULL
                                        CHECK (subject_type IN (
                                          'resident','staff','contractor_user','vehicle','guest'
                                        )),
        subject_resident_id             UUID REFERENCES residents(id) ON DELETE RESTRICT,
        subject_staff_id                UUID REFERENCES staff_users(id) ON DELETE RESTRICT,
        subject_contractor_user_id      UUID REFERENCES contractor_users(id) ON DELETE RESTRICT,
        subject_vehicle_id              UUID REFERENCES vehicles(id) ON DELETE RESTRICT,
        zone_id                         UUID,
        point_id                        UUID,
        policy_id                       UUID,
        valid_from                      TIMESTAMPTZ NOT NULL,
        valid_until                     TIMESTAMPTZ NOT NULL,
        status                          VARCHAR(20) NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','used','expired','revoked','blocked')),
        approved_by_staff_id            UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        revoked_at                      TIMESTAMPTZ,
        revoked_by_staff_id             UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        revoked_reason                  TEXT,
        created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT passes_subject_exclusive CHECK (
          (subject_type = 'resident'
             AND subject_resident_id IS NOT NULL
             AND subject_staff_id IS NULL
             AND subject_contractor_user_id IS NULL
             AND subject_vehicle_id IS NULL)
          OR (subject_type = 'staff'
             AND subject_resident_id IS NULL
             AND subject_staff_id IS NOT NULL
             AND subject_contractor_user_id IS NULL
             AND subject_vehicle_id IS NULL)
          OR (subject_type = 'contractor_user'
             AND subject_resident_id IS NULL
             AND subject_staff_id IS NULL
             AND subject_contractor_user_id IS NOT NULL
             AND subject_vehicle_id IS NULL)
          OR (subject_type = 'vehicle'
             AND subject_resident_id IS NULL
             AND subject_staff_id IS NULL
             AND subject_contractor_user_id IS NULL
             AND subject_vehicle_id IS NOT NULL)
          OR (subject_type = 'guest'
             AND subject_resident_id IS NULL
             AND subject_staff_id IS NULL
             AND subject_contractor_user_id IS NULL
             AND subject_vehicle_id IS NULL)
        ),
        CONSTRAINT passes_window CHECK (valid_until > valid_from),
        CONSTRAINT passes_revoke_audit CHECK (
          status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_passes_property_status
        ON passes(property_id, status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_passes_subject_vehicle
        ON passes(subject_vehicle_id) WHERE subject_vehicle_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_passes_window
        ON passes(valid_from, valid_until) WHERE status IN ('active','used')
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_passes_access_request
        ON passes(access_request_id) WHERE access_request_id IS NOT NULL
    `);
  },
};
