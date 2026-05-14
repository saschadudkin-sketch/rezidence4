---
name: domhub-backend-expert
description: Use when changing DomHub backend code under backend/src, especially platform-v1 routes, services, migrations, auth, tenant isolation, uploads, notifications, runtime jobs, Redis, and SSE fanout.
license: project-local
metadata:
  domain: backend
  project: DomHub
  source: project-local
---

# DomHub Backend Expert

Use this skill for backend implementation, review, debugging, or test work in `backend/`.

## Architecture Rules

- Keep routes thin. Put business rules in `backend/src/v1/services/` or focused validation helpers.
- Treat `/api/v1/*` as the source of truth. Deprecated `/api/*` aliases are compatibility shims only.
- Maintain per-property isolation. Do not let request code silently fall back to global or wrong-property data.
- Keep initial sync and SSE updates separate: hydrate bulk state once, then apply incremental events.
- Prefer existing helpers for auth, authorization, property DB resolution, audit logging, Redis, uploads, logging, and metrics.

## Migrations

- Platform-v1 property DB migrations live in `backend/src/v1/migrations/`.
- Follow `backend/src/v1/migrations/README.md`.
- Migrations are forward-only. Once released, do not edit old migration files; add a forward-fix migration.
- Avoid non-immutable functions in partial index predicates.
- Include tenant/property scoping in schema, indexes, and service queries where applicable.

## Testing

Use the narrowest meaningful check first:

- `cd backend && npm run test:ci`
- `cd backend && npm run test:coverage:critical`
- `cd backend && npm run test:contract`
- `cd backend && npm run test:integration:pg` when real PostgreSQL behavior matters.

## Security And Ops

- For auth and refresh work, verify `JWT_SECRET`, cookie scope, `FRONTEND_URL`, and `REFRESH_LEGACY_FALLBACK_ENABLED`.
- For realtime work, use `/api/v1/events/health` and Redis health signals.
- For uploads, signed local upload URLs require `UPLOAD_SIGNING_SECRET`; external photo URLs are intentionally rejected.
- Preserve structured logging, Sentry scrubbing, and metrics behavior.

