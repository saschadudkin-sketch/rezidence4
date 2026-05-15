---
name: domhub-tenant-ops
description: Use when changing DomHub tenant operations, platform/property database setup, preflight scripts, tenant provisioning, tenant migrations, restore drills, registry DB behavior, or deployment readiness.
license: project-local
metadata:
  domain: operations
  project: DomHub
  source: project-local
---

# DomHub Tenant Ops

Use this skill for work touching tenant lifecycle, multi-database setup, migrations, backup/restore, or production readiness.

## Source Areas

- Root scripts: `tenant:preflight`, `tenant:provision`, `tenant:migrate`, `tenant:restore-drill`
- `scripts/tenant-ops-*.cjs`
- `scripts/restore-drill*.cjs`
- `backend/src/platformMigrations.js`
- `backend/src/v1/migrations/`
- deployment docs and runbooks under `docs/runbooks/` and `docs/product/specs/`.

## Rules

- Keep registry/platform DB concerns separate from property DB concerns.
- A tenant operation must be explicit about which connection string it uses.
- Preserve forward-only migration policy.
- Do not treat a demo or E2E tenant as production evidence.
- Preflight scripts should fail with actionable messages rather than silently skipping checks.
- Restore drills should prove recoverability, not just script execution.

## Checks

- `npm run tenant:preflight`
- `npm run tenant:preflight:current`
- `npm run tenant:restore-drill:preflight`
- `npm run tenant:restore-drill` when the task changes restore logic.
- `cd backend && npm run test:integration:pg` when real database behavior matters.

