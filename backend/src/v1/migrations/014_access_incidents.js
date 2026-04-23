'use strict';

// platform-v1 property-DB migration 014 — access_incidents (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/access-incidents-spec.md §2.
//
// Управляемая очередь задач для службы безопасности: каждый случай отклонения
// заявки/пропуска, blacklist-хит, подозрительная серия попыток.  В legacy
// эта сущность отсутствовала полностью — deny-попытки не сохранялись нигде.
//
// Инварианты:
//   - CHECK resolved: status IN ('resolved','dismissed') → resolved_at IS NOT NULL
//   - related_* все три nullable: incident может быть standalone (guard видит
//     подозрительного человека без пасса/авто).
//   - severity — hardcoded enum; `critical` ставится только вручную.
//   - Auto-creation правила (из verify-flow) — в сервисе, см. qr-verification-spec §3.

module.exports = {
  id: 'v1_014_access_incidents',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_incidents (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id             UUID NOT NULL,
        related_pass_id         UUID REFERENCES passes(id) ON DELETE SET NULL,
        related_visit_log_id    UUID REFERENCES visit_logs_v2(id) ON DELETE SET NULL,
        related_vehicle_id      UUID REFERENCES vehicles(id) ON DELETE SET NULL,
        incident_type           VARCHAR(30) NOT NULL
                                CHECK (incident_type IN (
                                  'expired_pass_attempt','invalid_qr','blacklist_hit',
                                  'outside_time_window','unauthorized_vehicle',
                                  'manual_override','provider_conflict',
                                  'suspicious_repeat_attempt'
                                )),
        severity                VARCHAR(20) NOT NULL DEFAULT 'medium'
                                CHECK (severity IN ('low','medium','high','critical')),
        status                  VARCHAR(20) NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','investigating','resolved','dismissed')),
        title                   TEXT NOT NULL,
        description             TEXT,
        created_by_staff_id     UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        assigned_to_staff_id    UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        resolved_at             TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT access_incidents_resolved_audit CHECK (
          status NOT IN ('resolved','dismissed') OR resolved_at IS NOT NULL
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_incidents_property_status
        ON access_incidents(property_id, status)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_incidents_type
        ON access_incidents(incident_type)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_incidents_assigned
        ON access_incidents(assigned_to_staff_id)
        WHERE assigned_to_staff_id IS NOT NULL
    `);

    // Guard-console dashboard запрос: все открытые + investigating,
    // отсортированные по severity DESC, created_at DESC.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_incidents_open_queue
        ON access_incidents(property_id, severity DESC, created_at DESC)
        WHERE status IN ('open','investigating')
    `);

    // Idempotency guard: один system-created incident на (visit_log, type).
    // Ручные incidents (created_by_staff_id NOT NULL) могут дублироваться — это OK.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_access_incidents_visit_log_type
        ON access_incidents(related_visit_log_id, incident_type)
        WHERE related_visit_log_id IS NOT NULL AND created_by_staff_id IS NULL
    `);
  },
};
