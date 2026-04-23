'use strict';

// platform-v1 property-DB migration 012 — qr_passes_v2 (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/passes-spec.md §2, §7.1.
//
// QR-представление пропуска.  v2 отличается от legacy тем, что `pass_id` FK
// указывает на `passes`, а НЕ на `requests` (legacy таблица остаётся работать
// своим отдельным inventory до Фазы 7 миграции).
//
// Чтобы не конфликтовать с legacy таблицей `qr_passes`, создаём новую таблицу
// `qr_passes_v2` — legacy код читает legacy таблицу, v1 код пишет и читает v2.
// В Фазе 7 миграция данных переносит строки из legacy в v2 и переключает
// legacy-роуты на чтение из v2.
//
// `render_version` инкрементится при «пересоздай QR» (резидент потерял экран)
// — старый token становится невалидным сразу (UNIQUE token гарантирует
// единственность активного представления на pass).
//
// UNIQUE(pass_id) означает «один активный QR на пасс». Если нужно
// несколько — в v1 не поддержано (см. passes-spec §7).

module.exports = {
  id: 'v1_012_qr_passes_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_passes_v2 (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id     UUID NOT NULL,
        pass_id         UUID NOT NULL UNIQUE REFERENCES passes(id) ON DELETE CASCADE,
        token           TEXT NOT NULL UNIQUE,
        render_version  SMALLINT NOT NULL DEFAULT 1,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT qr_passes_v2_render_positive CHECK (render_version >= 1)
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_passes_v2_token
        ON qr_passes_v2(token)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qr_passes_v2_property
        ON qr_passes_v2(property_id)
    `);
  },
};
