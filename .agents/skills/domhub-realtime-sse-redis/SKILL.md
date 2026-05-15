---
name: domhub-realtime-sse-redis
description: Use when changing DomHub realtime behavior, SSE streams, Redis pub/sub fanout, event health checks, tenant-scoped event delivery, or initial-hydration versus incremental-update flows.
license: project-local
metadata:
  domain: realtime
  project: DomHub
  source: project-local
---

# DomHub Realtime SSE Redis

Use this skill for work touching:

- `backend/src/sse.js`
- `backend/src/sse-redis.js`
- `backend/src/lib/redisClient.js`
- `/api/v1/events/stream`
- `/api/v1/events/health`
- frontend sync feedback, event replay, or realtime update handling.

## Rules

- Keep bulk initial hydration and incremental SSE updates separate.
- Every tenant-scoped event must carry or derive the correct property context.
- Do not broadcast property data across tenants.
- Redis fanout is an adapter for multi-process delivery; local broadcast semantics must remain equivalent.
- Treat Redis outage as degraded realtime, not as permission to drop business persistence.
- Prefer explicit event names, stable payload shapes, and idempotent frontend application.

## Checks

- For backend changes, run the narrow Jest tests around SSE, Redis, runtime jobs, or affected services.
- For cross-page UI update changes, include relevant frontend tests and Playwright only if the behavior crosses views.
- When debugging, inspect `/api/v1/events/health` and Redis connectivity first.

