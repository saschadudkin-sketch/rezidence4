# Release Checklist — Audit Fixes

Use this checklist before promoting the audit-related changes to production.

## 1) Backend config and migrations
- [ ] DB migrations applied (`users.deleted_at`, indexes, revocation tables) in target env.
- [ ] Redis reachable from backend (if enabled) and fallback-to-DB path verified.
- [ ] `JWT_SECRET` is set and rotated per environment policy.
- [ ] `REFRESH_LEGACY_FALLBACK_ENABLED` confirmed (`0` by default unless rollback scenario).

## 2) Auth & user lifecycle smoke checks
- [ ] Active user can call `GET /api/v1/auth/me`.
- [ ] Soft-deleted user receives `401 User not found or deleted` on protected routes.
- [ ] `POST /api/v1/auth/logout` revokes token (`jti`) and clears cookies.
- [ ] `POST /api/v1/auth/refresh` rejects reuse of old refresh token.

## 3) Users API soft-delete checks
- [ ] `DELETE /api/v1/users/:uid` sets `deleted_at` and `updated_at`.
- [ ] `PATCH /api/v1/users/:uid` does not mutate soft-deleted rows.
- [ ] `GET /api/v1/users` excludes soft-deleted users.

## 4) Frontend HTTP behavior checks
- [ ] `X-Request-Id` stays the same across `request -> refresh -> retry` chain.
- [ ] Retry uses exponential backoff + jitter (no synchronized retry storm).
- [ ] CSRF header (`X-CSRF-Token`) sent from cookie.
- [ ] Upload path uses local `POST /api/v1/upload/photo` and handles 401 consistently.

## 5) API contract and SSE checks
- [ ] OpenAPI smoke allows 204 responses without content.
- [ ] OpenAPI smoke enforces schemas for `application/json` responses.
- [ ] SSE event IDs are UUID-based and unique across restart simulation.

## 6) Observability and on-call readiness
- [ ] Log correlation by `X-Request-Id` works in backend logs and dashboards.
- [ ] Alerts for auth/DB health and request errors are loaded (`ops/alerts/*`).
- [ ] Runbook links verified and on-call owner confirmed.

## 7) Final pre-release command set
- [ ] `npm --prefix backend test -- --runInBand src/__tests__/auth.test.js src/__tests__/middleware_auth.test.js src/__tests__/auth_redis_revocation.test.js src/__tests__/users.test.js src/__tests__/api_contract.test.js src/__tests__/sse.test.js`
- [ ] `npm --prefix frontend test -- --run src/services/providers/apiClient.test.js src/services/providers/apiClient.resetState.test.js src/services/providers/backendProvider.test.js`

## 8) Rollback notes
- [ ] Rollback plan documented (frontend bundle + backend deploy).
- [ ] If needed, temporary legacy refresh fallback can be enabled while incident is mitigated.
- [ ] No destructive data migration introduced by these fixes.
