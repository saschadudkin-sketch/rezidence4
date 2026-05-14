---
name: domhub-test-stack
description: Use when adding, fixing, or choosing DomHub tests across backend Jest/Supertest/Testcontainers, frontend Vitest/Testing Library/MSW, Playwright E2E, coverage gates, and touched-file verification.
license: project-local
metadata:
  domain: quality
  project: DomHub
  source: project-local
---

# DomHub Test Stack

Use this skill when tests are part of the task or when deciding the right verification scope.

## Test Layers

- Backend unit and service tests: Jest under `backend/src/__tests__/`.
- Backend route tests: Jest + Supertest.
- Backend integration tests: Testcontainers for PostgreSQL/Redis where real behavior matters.
- Frontend unit and view tests: Vitest + Testing Library under `frontend/src/**/*.test.tsx`.
- Frontend service tests: Vitest with existing provider/service patterns and MSW where appropriate.
- E2E: Playwright under `e2e/`.

## Commands

Root:

- `npm run test`
- `npm run e2e`
- `npm run verify`

Backend:

- `cd backend && npm run test:ci`
- `cd backend && npm run test:coverage:critical`
- `cd backend && npm run test:contract`
- `cd backend && npm run test:integration:pg`

Frontend:

- `cd frontend && npm run lint`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`
- `cd frontend && npm run verify:all`

## Selection Rules

- For narrow fixes, run the touched test or the smallest relevant suite first.
- For auth, request mutation, idempotency, tenant isolation, or upload changes, include backend critical coverage.
- For API shape changes, include OpenAPI drift and contract tests.
- For role workspace or navigation changes, include targeted frontend view tests and Playwright if behavior crosses pages.
- For SSE, Redis, and runtime jobs, include tests that validate incremental updates separately from initial hydration.

