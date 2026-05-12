'use strict';

// DH-58 — GIS ZhKH / OSS readiness export packages.
//
// This is intentionally a readiness/export registry, not a certified filing
// channel and not legally significant electronic OSS voting.

module.exports = {
  id: 'v1_045_gis_oss_readiness_exports',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS gis_oss_export_packages (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id                UUID NOT NULL,
        package_type               VARCHAR(30) NOT NULL DEFAULT 'oss_readiness'
                                   CHECK (package_type IN (
                                     'gis_zhkh','oss_readiness','resident_notice','protocol_archive'
                                   )),
        title                      VARCHAR(160) NOT NULL,
        status                     VARCHAR(20) NOT NULL DEFAULT 'generated'
                                   CHECK (status IN ('draft','generated','archived')),
        period_start               DATE,
        period_end                 DATE,
        document_ids               UUID[] NOT NULL DEFAULT '{}'::uuid[],
        announcement_ids           UUID[] NOT NULL DEFAULT '{}'::uuid[],
        protocol_files             JSONB NOT NULL DEFAULT '[]'::jsonb,
        operational_record_refs    JSONB NOT NULL DEFAULT '[]'::jsonb,
        export_payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
        boundary_notice            TEXT NOT NULL,
        legally_authoritative      BOOLEAN NOT NULL DEFAULT false
                                   CHECK (legally_authoritative = false),
        certified_submission       BOOLEAN NOT NULL DEFAULT false
                                   CHECK (certified_submission = false),
        generated_by_uid           TEXT,
        generated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT gis_oss_export_period CHECK (
          period_start IS NULL OR period_end IS NULL OR period_end >= period_start
        ),
        CONSTRAINT gis_oss_export_title_not_blank CHECK (length(trim(title)) > 0)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gis_oss_export_packages_property
        ON gis_oss_export_packages(property_id, package_type, generated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gis_oss_export_packages_status
        ON gis_oss_export_packages(property_id, status, updated_at DESC)
    `);
  },
};
