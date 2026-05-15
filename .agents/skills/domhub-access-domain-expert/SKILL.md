---
name: domhub-access-domain-expert
description: Use when changing DomHub access requests, passes, QR verification, vehicles, visit logs, access incidents, policies, topology, guard console behavior, or access-related state machines.
license: project-local
metadata:
  domain: access
  project: DomHub
  source: project-local
---

# DomHub Access Domain Expert

Use this skill for the access-control product domain.

## Sources

- `ACCESS_SOURCE_OF_TRUTH.md`
- `docs/product/specs/domhub-access-platform-final-plan.md`
- `docs/product/specs/domhub-access-api-contract-spec.md`
- `docs/product/specs/domhub-access-data-model-spec.md`
- `docs/product/specs/platform-v1/access-requests-spec.md`
- `docs/product/specs/platform-v1/passes-spec.md`
- `docs/product/specs/platform-v1/qr-verification-spec.md`
- `docs/product/specs/platform-v1/vehicles-spec.md`
- `docs/product/specs/platform-v1/visit-logs-spec.md`
- `docs/product/specs/platform-v1/access-incidents-spec.md`

## Rules

- Preserve access state-machine invariants and conflict handling.
- QR verification must be auditable and tenant-scoped.
- Pass lifecycle rules differ for guest, resident, staff, contractor, and vehicle passes.
- Access incidents should link to evidence where possible without overexposing PII.
- Guard-console flows must optimize for fast decisions and clear denial reasons.
- Do not regress stale mutation handling with `expectedCurrentStatus`.

## Checks

- Run access service/state-machine tests for backend rule changes.
- Run E2E v1 access tests for cross-flow changes.
- Run API contract drift checks for route or response changes.

