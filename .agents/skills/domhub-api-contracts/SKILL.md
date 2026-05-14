---
name: domhub-api-contracts
description: Use when changing DomHub API contracts, OpenAPI documentation, generated frontend API types, route compatibility, contract tests, or API drift gates.
license: project-local
metadata:
  domain: api
  project: DomHub
  source: project-local
---

# DomHub API Contracts

Use this skill for API contract design, review, and drift prevention.

## Source Of Truth

- `/api/v1/*` is canonical.
- Deprecated `/api/*` routes are compatibility shims only.
- `docs/openapi.json` is the machine-readable OpenAPI contract.
- `docs/api/README.md` describes current OpenAPI coverage and known gaps.

## Workflow

1. Identify the canonical `/api/v1/*` route and the backend service it delegates to.
2. Update route behavior, tests, and OpenAPI schema together when changing request or response shape.
3. Keep auth requirements explicit: JWT cookie and `X-Complex-Slug` where required by platform-v1.
4. Maintain consistent status codes, error shapes, pagination/filter query params, and idempotency semantics.
5. Regenerate frontend API types when OpenAPI changes:
   - `npm run openapi:types`
6. Run drift/contract checks:
   - `npm run openapi:drift`
   - `cd backend && npm run test:contract`

## Guardrails

- Do not add new frontend code against legacy `/api/*` aliases.
- Do not silently widen response shapes for sensitive resident, access, pass, staff, audit, notification, or upload data.
- Preserve stale mutation conflict behavior where `expectedCurrentStatus` is used.

