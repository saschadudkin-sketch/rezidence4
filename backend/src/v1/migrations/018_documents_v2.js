'use strict';

// platform-v1 property-DB migration 018 — documents_v2 + document_versions (Фаза 5).
// Spec: docs/product/specs/platform-v1/documents-v2-spec.md §2.
//
// Статический контент резидентского портала: правила, контакты УК,
// инструкции, договоры, нормативы.  В отличие от announcements_v2 —
// НЕ триггерит fan-out уведомлений при публикации; это справочник.
//
// Ключевые изменения vs legacy `documents`:
//   - property_id (legacy был single-tenant)
//   - body_md TEXT (legacy body был без указания формата)
//   - file_url + file_mime + file_size_bytes (legacy — только URL)
//   - расширенный enum категории: rules/contacts/instructions/contracts/
//     safety/legal/other (legacy — 5 категорий, без safety/legal)
//   - tag VARCHAR(40) — свободный ярлык поверх enum
//   - created_by_staff_id/updated_by_staff_id (legacy author_id TEXT
//     больше не работает после split users → staff/resident/contractor)
//   - document_versions — явная история вместо inline counter
//
// Инварианты §2.1:
//   body_md IS NOT NULL OR file_url IS NOT NULL  (документ не пустой)
//   file_url IS NOT NULL ⇒ file_mime + file_size_bytes заполнены
//   deleted_at IS NULL OR deleted_at >= created_at
//
// file_url validation '/uploads/*' — service-level (миграция не может
// знать uploads prefix).

module.exports = {
  id: 'v1_018_documents_v2',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents_v2 (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id           UUID NOT NULL,
        title                 TEXT NOT NULL,
        category              VARCHAR(20) NOT NULL
                                CHECK (category IN (
                                  'rules','contacts','instructions','contracts',
                                  'safety','legal','other'
                                )),
        tag                   VARCHAR(40),
        body_md               TEXT,
        file_url              TEXT,
        file_mime             VARCHAR(60),
        file_size_bytes       INTEGER,
        is_public             BOOLEAN NOT NULL DEFAULT false,
        sort_order            INTEGER NOT NULL DEFAULT 0,
        published_at          TIMESTAMPTZ,
        created_by_staff_id   UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        updated_by_staff_id   UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at            TIMESTAMPTZ,
        CONSTRAINT documents_v2_has_content CHECK (
          body_md IS NOT NULL OR file_url IS NOT NULL
        ),
        CONSTRAINT documents_v2_file_metadata CHECK (
          file_url IS NULL
          OR (file_mime IS NOT NULL AND file_size_bytes IS NOT NULL)
        ),
        CONSTRAINT documents_v2_file_size_nonneg CHECK (
          file_size_bytes IS NULL OR file_size_bytes >= 0
        ),
        CONSTRAINT documents_v2_delete_audit CHECK (
          deleted_at IS NULL OR deleted_at >= created_at
        )
      )
    `);

    // Основной list-запрос в UI (per-property, per-category, sort).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_v2_property_category_sort
        ON documents_v2(property_id, category, sort_order)
    `);

    // Publicly-visible partial index (для /public/:slug/documents).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_v2_public
        ON documents_v2(property_id, is_public, published_at)
        WHERE deleted_at IS NULL AND published_at IS NOT NULL
    `);

    // Tag-based filtering.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_v2_tag
        ON documents_v2(property_id, tag)
        WHERE tag IS NOT NULL
    `);

    // «Недавно обновлённые» admin view.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_v2_updated_at
        ON documents_v2(updated_at DESC)
    `);

    // --- document_versions (§2.2) ------------------------------------
    // Снэпшоты снимаются ДО UPDATE documents_v2 при изменении body_md/
    // title/file_url.  Резидентский hot path не трогает эту таблицу —
    // она нужна только для админского аудита «дайте редакцию на
    // 2025-03-01».
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_versions (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id           UUID NOT NULL REFERENCES documents_v2(id) ON DELETE CASCADE,
        version               INTEGER NOT NULL,
        title_snapshot        TEXT NOT NULL,
        body_md_snapshot      TEXT,
        file_url_snapshot     TEXT,
        archived_by_staff_id  UUID REFERENCES staff_users(id) ON DELETE SET NULL,
        archived_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason                TEXT,
        CONSTRAINT document_versions_version_positive CHECK (version >= 1)
      )
    `);

    // Per-document monotonic version history.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_document_versions_doc_version
        ON document_versions(document_id, version DESC)
    `);
  },
};
