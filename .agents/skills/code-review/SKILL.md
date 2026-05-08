---
name: code-review
description: Review rezidence4/DomHub code changes for bugs, regressions, security issues, tenant isolation breaks, API contract drift, missing tests, and release blockers. Use when the user asks for code review, review, audit of changes, PR review, regression check, release blocker check, or wants changed files inspected before commit/PR.
---

# Code Review

Review as a senior engineer for `rezidence4`, with findings first and minimal summary. Prioritize concrete bugs and release risk over style advice.

## Scope

Start from the user's requested scope. If no scope is given, inspect the current git diff and untracked files relevant to the change. Do not review unrelated dirty work unless it affects the requested area.

Treat these project rules as review constraints:

- `/api/v1/*` is the source of truth for contracts; deprecated `/api/*` aliases are compatibility shims only.
- Backend routes should stay thin; business rules belong in services or focused validation helpers.
- Tenant/property isolation must be preserved across registry DB, property DB, migrations, services, and routes.
- Auth, refresh, role checks, soft-delete handling, and permission boundaries are high-risk areas.
- Initial sync and SSE incremental updates are separate concerns; do not mix bulk hydration behavior with realtime patch handling.
- Frontend uses selector-based bounded contexts; prefer selectors for derived collections instead of recomputing in views.
- Platform roles, workflows, and rollout decisions should align with `docs/product/specs/domhub-final-product-plan.md` and delivery planning docs unless the user explicitly overrides them.

## Review Priorities

Order findings by severity:

1. Security, auth, permission, tenant isolation, data-loss, migration, or production outage risk.
2. API contract drift, backwards compatibility breaks, stale SSE/client state, race conditions, or missing conflict handling.
3. Incorrect business behavior, broken edge cases, poor error handling, or test gaps in changed risk areas.
4. Maintainability issues only when they create likely future defects.

Avoid listing low-value nits unless the user asks for style review.

## Checks To Consider

Choose checks based on touched files and risk:

- Backend/auth/request paths: `npm run backend:test` and `npm run test:coverage:critical`.
- Frontend TypeScript changes: `npm run typecheck`.
- Frontend UI changes: `npm run frontend:lint`, targeted Vitest, and browser/Playwright inspection when visual behavior matters.
- E2E/user-flow/realtime changes: `npm run e2e` or a targeted Playwright spec.
- Product/spec changes: compare against `docs/product/specs/`, `IMPLEMENTATION_ORDER.md`, and `ACCESS_SOURCE_OF_TRUTH.md`.

If checks are too expensive or blocked, say exactly what was not run and why.

## Output Format

Lead with findings. For each finding, include severity, file/line reference, impact, and the smallest useful fix direction.

Use inline code review comments when supported by the environment. Keep line ranges tight.

After findings, include:

- Open questions or assumptions, if any.
- Test gaps or commands run.
- A short summary only after the issues.

If no issues are found, say that clearly and still mention residual risk or checks not run.
