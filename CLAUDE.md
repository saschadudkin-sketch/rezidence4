# CLAUDE.md

## Architecture Patterns

- `frontend/` uses a selector-based store with bounded contexts. Prefer selectors for derived collections instead of recomputing in views.
- `backend/` keeps routes thin and pushes business rules into services or focused validation helpers.
- `/api/v1/*` is the source of truth for contracts. Deprecated `/api/*` aliases are compatibility shims only.
- Initial sync and SSE updates are separate concerns: bulk hydrate once, then apply incremental updates.

## Troubleshooting

- Auth and refresh:
  - Verify `JWT_SECRET`, cookie scope, and `FRONTEND_URL`.
  - Check whether `REFRESH_LEGACY_FALLBACK_ENABLED` is intentionally enabled.
- Realtime:
  - Use `/api/v1/events/health` and Redis health to debug SSE fanout issues.
  - `409 Conflict` on request mutation means the client sent a stale `expectedCurrentStatus`; refresh and retry.
- Uploads:
  - Signed uploads require `UPLOAD_SIGNING_SECRET` and local `/uploads/` URLs.
  - External photo URLs are rejected intentionally.
- CI:
  - Backend CI now includes a coverage gate for critical auth/request paths.
  - Playwright tests clear cookies before each test to avoid state leakage.

## Local Checks

- Root:
  - `npm run test`
  - `npm run e2e`
- Backend:
  - `npm run test:ci`
  - `npm run test:coverage:critical`
- Frontend:
  - `npm run lint`
  - `npm run typecheck`
