---
name: domhub-integrations-skud-erp
description: Use when changing DomHub SKUD/access-control providers, VMS/NVR integrations, ERP/1C exchange, provider configuration, integration events, failure dashboards, hardware mapping, or manual-control boundaries.
license: project-local
metadata:
  domain: integrations
  project: DomHub
  source: project-local
---

# DomHub Integrations SKUD ERP

Use this skill for access-control hardware, video evidence providers, ERP/1C exchange, and integration readiness.

## Relevant Sources

- `docs/product/specs/domhub-integration-architecture-spec.md`
- `docs/product/specs/domhub-skud-vendor-priority-spec.md`
- `docs/product/specs/domhub-erp-1c-integration-spec.md`
- `docs/product/specs/platform-v1/skud-provider-failure-dashboard-spec.md`
- `docs/product/specs/platform-v1/gis-oss-readiness-spec.md`
- migrations and services around SKUD, video evidence, ERP exchange, and hardware manual control.

## Rules

- External providers must not become the source of truth for tenant identity or permissions.
- Store provider configs and events with explicit property scope.
- Preserve audit records for manual control, overrides, evidence attachment, and provider failure handling.
- Integration failures should surface as operational evidence and dashboards, not hidden logs only.
- Treat imports as preview/apply workflows when data can affect residents, passes, staff, units, vehicles, or access.
- Keep provider adapters isolated from route handlers and business services.

## Checks

- Add service tests for mapping, validation, idempotency, and tenant isolation.
- Add contract tests for new provider endpoints.
- Run readiness/preflight scripts when deployment or integration evidence changes.

