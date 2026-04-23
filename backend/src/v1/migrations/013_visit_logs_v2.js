'use strict';

// platform-v1 property-DB migration 013 — visit_logs_v2 (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/visit-logs-spec.md §2.
//
// Append-only журнал событий прохода/проезда.  В legacy событий не было —
// фиксировался только `qr_passes.used_at` (первый успех, и всё).  Здесь
// каждая попытка скана/ручного пропуска = отдельная строка.
//
// `_v2` суффикс — чтобы избежать конфликтов с legacy.  Table name в коде
// ссылается как `visit_logs_v2`, но в спеке и комментариях зовётся
// `visit_logs` — это нормально для v1 периода (legacy-таблицы этого имени
// нет, suffix оставлен для симметрии с qr_passes_v2).
//
// `provider_event_id` + `event_source` UNIQUE partial index — защита от
// дубля при ретрае вебхука СКУД.
//
// `access_point_id` — nullable UUID без FK: access_points таблицу создаём
// только пост-релиз при появлении первого СКУД-интегратора.

module.exports = {
  id: 'v1_013_visit_logs_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS visit_logs_v2 (
        id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                 UUID NOT NULL,
        pass_id                     UUID REFERENCES passes(id) ON DELETE SET NULL,
        access_point_id             UUID,
        event_type                  VARCHAR(20) NOT NULL
                                    CHECK (event_type IN (
                                      'entry_allowed','entry_denied',
                                      'exit_allowed','exit_denied',
                                      'manual_admit','manual_deny','override'
                                    )),
        event_source                VARCHAR(20) NOT NULL
                                    CHECK (event_source IN ('domhub','skud','guard_console','import')),
        person_label                TEXT,
        vehicle_plate               TEXT,
        performed_by_staff_id       UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        provider_event_id           TEXT,
        provider_payload            JSONB,
        occurred_at                 TIMESTAMPTZ NOT NULL,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_logs_v2_property_time
        ON visit_logs_v2(property_id, occurred_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_logs_v2_pass
        ON visit_logs_v2(pass_id) WHERE pass_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_logs_v2_access_point
        ON visit_logs_v2(access_point_id) WHERE access_point_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visit_logs_v2_plate
        ON visit_logs_v2(vehicle_plate) WHERE vehicle_plate IS NOT NULL
    `);

    // Partial UNIQUE: дедуп повторных вебхуков СКУД по (event_source,
    // provider_event_id).  `domhub` и `guard_console` не присылают
    // provider_event_id — для них этот индекс не применим.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_logs_v2_provider_event
        ON visit_logs_v2(event_source, provider_event_id)
        WHERE provider_event_id IS NOT NULL
    `);
  },
};
