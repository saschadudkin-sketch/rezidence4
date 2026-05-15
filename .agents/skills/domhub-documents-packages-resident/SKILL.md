---
name: domhub-documents-packages-resident
description: Use when changing DomHub resident-facing documents, packages, announcements, resident ownership/offboarding, resident pages, package photo uploads, or resident privacy boundaries.
license: project-local
metadata:
  domain: resident
  project: DomHub
  source: project-local
---

# DomHub Documents Packages Resident

Use this skill for resident-facing content, packages, documents, ownership, and offboarding flows.

## Sources

- `docs/product/specs/platform-v1/documents-v2-spec.md`
- `docs/product/specs/platform-v1/packages-v2-spec.md`
- `docs/product/specs/platform-v1/announcements-v2-spec.md`
- `docs/product/specs/platform-v1/residents-spec.md`
- `docs/product/specs/platform-v1/resident-ownership-transfer-spec.md`
- `docs/product/specs/platform-v1/resident-offboarding-report-spec.md`
- frontend resident pages under `frontend/src/v1/pages/`.

## Rules

- Resident APIs must expose only documents, packages, and records the resident can legitimately access.
- Package pickup flows belong to concierge/staff identity verification, not resident self-completion.
- Document categories and ordering should match resident mental models.
- Offboarding must cascade access, vehicles, passes, and review queues according to specs.
- Upload URLs must remain local signed `/uploads/` paths where required.

## Checks

- Run resident page smoke tests for frontend changes.
- Run packages/documents/resident backend tests for route or service changes.
- Include privacy checks when resident data exposure changes.

