---
name: domhub-audit-evidence-review
description: Use when changing DomHub audit event catalog, property audit log, sensitive actions review, weekly review reports, anti-abuse analytics, evidence capture, or review lifecycle.
license: project-local
metadata:
  domain: audit
  project: DomHub
  source: project-local
---

# DomHub Audit Evidence Review

Use this skill for auditability, sensitive action review, and evidence workflows.

## Sources

- `docs/product/specs/platform-v1/sensitive-actions-review-report-spec.md`
- `docs/product/specs/domhub-security-threat-model.md`
- backend audit event catalog, audit review services, and sensitive report routes.
- frontend sensitive actions review pages.

## Rules

- Sensitive actions need stable event classification and actor metadata.
- Evidence records should be immutable enough for review and explicit about source tables.
- Review lifecycle states must be auditable and tenant-scoped.
- Anti-abuse analytics should avoid exposing raw PII when aggregate evidence is sufficient.
- Reports need generated-at, scope, source, filters, and reviewer/action history.

## Checks

- Run audit catalog, audit review service, and sensitive actions route tests.
- Run frontend review page tests for UI changes.
- Include privacy/security review for new evidence fields.

