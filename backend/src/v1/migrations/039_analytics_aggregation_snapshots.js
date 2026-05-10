'use strict';

// platform-v1 property-DB migration 039 — analytics aggregation snapshots.
//
// DH-45 materializes the DH-35 operational dashboard formulas into durable
// property-scoped snapshots. Dashboards can still compute live values, while
// reporting/export flows can read a consistent snapshot and its flat KPI rows.

module.exports = {
  id: 'v1_039_analytics_aggregation_snapshots',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_kpi_snapshots (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id          UUID NOT NULL,
        metric_group         VARCHAR(60) NOT NULL DEFAULT 'operations_dashboard'
                            CHECK (metric_group IN ('operations_dashboard')),
        period               VARCHAR(20) NOT NULL
                            CHECK (period IN ('24h','7d','30d')),
        window_started_at    TIMESTAMPTZ NOT NULL,
        window_ended_at      TIMESTAMPTZ NOT NULL,
        generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        generated_by         VARCHAR(30) NOT NULL DEFAULT 'job'
                            CHECK (generated_by IN ('job','manual','system')),
        source_version       VARCHAR(30) NOT NULL DEFAULT 'dh45_v1',
        payload              JSONB NOT NULL,
        flat_rows            JSONB NOT NULL DEFAULT '[]'::jsonb,
        row_count            INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT analytics_kpi_snapshots_window_check
          CHECK (window_started_at < window_ended_at),
        CONSTRAINT analytics_kpi_snapshots_payload_object
          CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT analytics_kpi_snapshots_flat_rows_array
          CHECK (jsonb_typeof(flat_rows) = 'array')
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_kpi_snapshots_latest
        ON analytics_kpi_snapshots(property_id, metric_group, period, generated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_kpi_snapshots_window
        ON analytics_kpi_snapshots(property_id, period, window_ended_at DESC)
    `);
  },
};
