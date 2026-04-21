# DomHub Access Source Of Truth

This file exists to anchor all access-control implementation work to the same set of documents.

## Use This For

- guest access
- QR passes
- vehicle access
- security workspace
- contractor/service access
- access incidents
- zones / points / policies
- access analytics
- SKUD/video integrations

## Primary Access Documents

Read these first for any access-related implementation:

1. `docs/product/specs/domhub-access-platform-final-plan.md`
2. `docs/product/specs/domhub-access-data-model-spec.md`
3. `docs/product/specs/domhub-access-policy-spec.md`
4. `docs/product/specs/domhub-state-machines-spec.md`
5. `docs/product/specs/domhub-access-api-contract-spec.md`

## Supporting Access Documents

Use when relevant:

- `docs/product/specs/domhub-test-strategy-spec.md`
- `docs/product/specs/domhub-deployment-and-tenant-ops-spec.md`
- `docs/product/specs/domhub-integration-architecture-spec.md`
- `docs/product/specs/domhub-skud-vendor-priority-spec.md`
- `docs/product/specs/domhub-video-integration-spec.md`
- `docs/product/specs/domhub-analytics-metric-definitions.md`
- `docs/product/specs/domhub-packaging-and-feature-gating-spec.md`

## Implementation Rule

When access documentation conflicts with older generic platform notes, prefer the newer access-specific documents unless the user explicitly says otherwise.

## Practical Rule

Do not invent:
- new access statuses
- new pass types
- new policy semantics
- new tenant ownership boundaries

without updating the access source-of-truth docs.

