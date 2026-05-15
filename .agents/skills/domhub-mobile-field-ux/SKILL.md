---
name: domhub-mobile-field-ux
description: Use when changing DomHub mobile guard, concierge, technician, or contractor flows involving QR scan, camera/photo upload, offline replay, touch ergonomics, field evidence, or mobile E2E behavior.
license: project-local
metadata:
  domain: mobile-ux
  project: DomHub
  source: project-local
---

# DomHub Mobile Field UX

Use this skill for mobile-first operational workflows.

## Sources

- `e2e/mobile-interaction-contract.spec.js`
- `e2e/navigation-mobile.spec.js`
- `docs/product/specs/platform-v1/qr-verification-spec.md`
- `docs/product/specs/platform-v1/contractor-portal-ui-spec.md`
- `docs/product/specs/platform-v1/technician-workspace-ui-spec.md`
- upload, QR, pass, visit, incident, and evidence workflows.

## Rules

- Optimize for one-handed field use and fast recovery from mistakes.
- QR and camera flows need explicit permission, failure, retry, and manual fallback states.
- Offline replay must be idempotent, tenant-scoped, and visibly pending until confirmed.
- Touch targets must remain stable across loading and error states.
- Do not cache or expose sensitive resident data across users or tenants.

## Checks

- Run mobile Playwright tests for navigation or field-flow changes.
- Run upload and QR service tests for backend behavior changes.
- Use browser verification for camera, viewport, and touch-specific changes when feasible.

