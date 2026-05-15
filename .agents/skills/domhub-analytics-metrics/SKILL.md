---
name: domhub-analytics-metrics
description: Use when changing DomHub analytics, KPI definitions, operations dashboards, metric aggregation snapshots, SLA calculations, reporting APIs, or metric-facing UI.
license: project-local
metadata:
  domain: analytics
  project: DomHub
  source: project-local
---

# DomHub Analytics Metrics

Use this skill for analytics definitions, aggregation jobs, dashboard APIs, and metric UI.

## Sources

- `docs/product/specs/domhub-analytics-metric-definitions.md`
- `docs/product/specs/domhub-event-taxonomy-spec.md`
- `docs/product/specs/platform-v1/service-requests-spec.md`
- `frontend/src/v1/pages/OperationsDashboardPage.tsx`
- backend analytics aggregation services and migrations.

## Rules

- Keep metric names, windows, denominators, and null behavior explicit.
- Do not mix demo, staging, and production evidence in the same metric semantics.
- Preserve tenant/property scoping in every aggregation.
- Document whether a metric is point-in-time, rolling-window, or snapshot-based.
- SLA metrics must define start event, stop event, pause behavior, and excluded states.
- Dashboard UI should show stale/empty/error states and avoid implying precision that the source data cannot support.

## Checks

- Run backend analytics service tests when aggregation SQL or snapshots change.
- Run frontend dashboard tests when metric display, formatting, or empty states change.
- Include API contract checks for dashboard response shape changes.

