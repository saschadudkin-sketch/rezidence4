---
name: domhub-privacy-compliance
description: Use when changing DomHub personal-data flows, privacy controls, DSAR handling, retention/deletion, resident exports, audit evidence, legal/compliance docs, or sensitive operational review features.
license: project-local
metadata:
  domain: privacy
  project: DomHub
  source: project-local
---

# DomHub Privacy Compliance

Use this skill for resident/staff personal data, sensitive actions, privacy controls, and compliance evidence.

## Relevant Sources

- `docs/product/specs/platform-v1/privacy-compliance-controls-spec.md`
- `docs/product/specs/domhub-security-threat-model.md`
- `docs/legal/`
- backend privacy, audit, resident, staff, upload, and offboarding services.

## Rules

- Minimize personal data exposure in API responses and logs.
- Preserve tenant scoping for every privacy, resident, staff, export, deletion, and audit query.
- Record evidence for sensitive state changes.
- Treat retention, deletion, export, and DSAR flows as auditable workflows with owners, timestamps, status, and resolution.
- Never put secrets, raw tokens, or unnecessary PII into logs, Sentry context, or test snapshots.
- Keep legal docs and product specs aligned when behavior changes.

## Checks

- Include security or privacy service tests when touching data subject requests, offboarding, retention, uploads, residents, or audit review flows.
- Include Sentry scrubbing tests when logging or error reporting changes.
- Include API contract checks when response shapes expose sensitive fields.

