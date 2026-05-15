---
name: jest-expert
description: Use when writing, fixing, or reviewing backend Jest tests, Supertest route tests, Testcontainers integration tests, mocked services, timers, Redis/Postgres behavior, or critical coverage gates.
license: project-local
metadata:
  domain: testing
  project: DomHub
  source: project-local
---

# Jest Expert

Use this skill for backend tests under `backend/src/__tests__/`.

## Rules

- Test service business rules directly; keep route tests focused on HTTP contract, auth, validation, and delegation.
- Use Supertest for Express routes.
- Use Testcontainers only when real PostgreSQL or Redis behavior is material.
- Keep mocks local, explicit, and reset between tests.
- Avoid tests that pass because SQL strings are overly mocked; assert parameters, tenant scope, and state transitions.
- For async workers and runtime jobs, control timers and flush promises deliberately.

## Commands

- `cd backend && npm run test:ci`
- `cd backend && npm run test:coverage:critical`
- `cd backend && npm run test:contract`
- `cd backend && npm run test:integration:pg`
- `cd backend && npm run test:detect-open-handles` for leaks.

## DomHub Notes

- Auth, tenant isolation, request mutation, idempotency, upload, notification outbox, and access-control changes need focused tests.
- Prefer table-driven tests for state machines and permission matrices.

