---
name: domhub-product-spec-drift-audit
description: Use when auditing drift between DomHub product specs, platform-v1 module specs, OpenAPI contracts, backend services/routes, frontend API/types/pages, tests, and release plans.
license: project-local
metadata:
  domain: product-drift
  project: DomHub
  source: project-local
---

# DomHub Product Spec Drift Audit

Use this skill when checking whether implementation and documentation still agree.

## Sources

- `docs/product/specs/domhub-final-product-plan.md`
- `docs/product/specs/platform-v1/`
- `docs/openapi.json`
- `docs/api/README.md`
- `backend/src/v1/routes/`
- `backend/src/v1/services/`
- `frontend/src/v1/api/`
- `frontend/src/v1/pages/`
- acceptance and readiness scripts under `scripts/`.

## Checks

- `/api/v1/*` routes match OpenAPI paths and schemas.
- Frontend API types and service calls match backend route behavior.
- Platform-v1 module specs match migrations, services, UI, and tests.
- Deprecated `/api/*` aliases remain compatibility shims only.
- Product states and backend state machines agree.
- Acceptance criteria have corresponding tests or explicit gaps.
- Roadmap and release gate docs do not claim shipped behavior that is only planned.

## Commands

- `npm run openapi:drift`
- `npm run openapi:types`
- `cd backend && npm run test:contract`
- targeted backend/frontend tests for the audited module.

## Output

Lead with drift findings:

```text
Verdict: PASS|WARN|FAIL

Drift findings:
- [P1] spec -> implementation mismatch

Missing coverage:
- ...

Suggested fixes:
- ...
```

