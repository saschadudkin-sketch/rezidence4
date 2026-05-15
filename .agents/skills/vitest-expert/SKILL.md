---
name: vitest-expert
description: Use when writing, fixing, or reviewing Vitest tests, React Testing Library tests, jsdom behavior, MSW mocks, frontend service tests, hooks tests, or frontend coverage gates.
license: project-local
metadata:
  domain: testing
  project: DomHub
  source: project-local
---

# Vitest Expert

Use this skill for frontend tests in `frontend/src/**/*.test.tsx` or related Vitest configuration.

## Rules

- Test user-visible behavior and stable domain outcomes, not implementation details.
- Prefer Testing Library queries by role, label, text, and accessible names.
- Use existing service providers, fixtures, and MSW setup before ad hoc mocks.
- Keep async assertions explicit with `findBy*`, `waitFor`, or settled promises.
- Avoid leaking state between tests; reset mocks, query clients, timers, local storage, and DOM side effects.
- Keep selector-store tests focused on derived state and bounded contexts.

## Commands

- `cd frontend && npm run test`
- `cd frontend && npm run test:ux-critical`
- `cd frontend && npm run test:mode-services`
- `cd frontend && npm run typecheck`

## DomHub Notes

- For `/api/v1/*` changes, keep frontend mocks aligned with `docs/openapi.json`.
- For realtime UI, test initial hydrate separately from incremental events.
- For role workspaces, assert permission-specific visibility and disabled states.

