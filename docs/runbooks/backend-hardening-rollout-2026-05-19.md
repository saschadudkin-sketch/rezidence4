# Backend Hardening Rollout Summary - 2026-05-19

Status: Ready for staging/prod-candidate rollout after normal deployment
approval.

Scope: backend hardening commits `0eac5329..cbe55ee6`, covering v1
property-scoped reads, mutation conflict handling, notification/outbox scope,
workspace joins, property-owned reference constraints, tenant migration gates,
and legacy webhook delivery side effects.

## Change Summary

- Detail/list/admin reads now enforce tenant/property scope before returning
  property-owned objects.
- State-changing access endpoints use resource lookup, property RBAC, scoped
  mutation predicates, stale-status conflict handling, and post-success audit
  logging where applicable.
- Notification log and admin outbox reads are scoped by tenant/property and
  correlation reads are covered by endpoint/service tests.
- `backend:v1-property-scope-audit` now guards more unsafe id-only read and
  mutation patterns.
- Property-owned reference hardening migration `v1_058` adds defensive foreign
  keys, check constraints, and indexes around access/pass/vehicle/trusted
  visitor relations.
- Tenant ops migration/provision commands now load `.env` and `backend/.env`
  consistently with preflight.
- Legacy webhook delivery stops queued sends for inactive webhooks before any
  outbound network call.

## Required Pre-Deploy Checks

Run from repo root:

```bash
npm run verify
npm run security:scan
npm run backend:v1-property-scope-audit
npm run tenant:preflight:current
npm run release:gate:check
npm run e2e
```

Local evidence captured on 2026-05-19:

- `node scripts/run-checks.cjs verify`: passed; backend `165/165` suites,
  `2612` tests; frontend `178/178` files, `1293` tests; production build
  passed.
- `npm run security:scan`: passed; gitleaks plus semgrep, `0` findings.
- `npm run backend:v1-property-scope-audit`: passed.
- `npm run tenant:preflight:current`: passed; platform migrations `7/7`,
  tenant migrations `76/76`.
- `npm run release:gate:check`: passed all release gates.
- `npm run e2e`: passed selected desktop/mobile Playwright shards,
  `infrastructureRetries=0`.

## Migration Procedure

1. Run `npm run tenant:migrate -- --dry-run --batch-size 1` against the target
   environment and confirm the selected tenant set.
2. Run `npm run tenant:migrate -- --batch-size <N>` with a conservative batch
   size for staging first, then prod-candidate.
3. Run `npm run tenant:preflight:current` after migrations and require all
   platform and tenant migrations to be current.
4. Smoke admin/security flows that touch access requests, passes, vehicles,
   trusted visitors, notification log, admin outbox, and webhooks.

## Rollback Notes

- The code changes are rollback-safe through the normal backend deploy rollback.
- Migration `v1_058` is additive/defensive and should not be manually reverted
  during an incident without a DBA review.
- If a property-scoped mutation starts returning `409 Conflict`, treat it as a
  stale-client/status issue first: refresh the resource and retry with the
  current status.
- If webhook delivery drops after rollout, check whether the webhook was
  intentionally deactivated. Queued deliveries for inactive webhooks now fail
  permanently instead of being sent.

## Residual Risks

- E2E still covers selected smoke shards, not every v1 backend endpoint.
- Legacy `/api/*` compatibility shims remain in the product and should stay
  treated as migration support, not as the source of truth.
- Production evidence still depends on environment-specific DB, Redis, and
  provider connectivity checks outside this local repository run.
