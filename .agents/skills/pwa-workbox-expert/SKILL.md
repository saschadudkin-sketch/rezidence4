---
name: pwa-workbox-expert
description: Use when changing DomHub PWA behavior, Vite PWA configuration, Workbox precaching/routing/strategies, service workers, offline behavior, installability, cache invalidation, or web push integration.
license: project-local
metadata:
  domain: frontend
  project: DomHub
  source: project-local
---

# PWA Workbox Expert

Use this skill for `vite-plugin-pwa`, Workbox, service worker, cache, installability, and offline behavior.

## Rules

- Do not cache authenticated API responses unless the data is explicitly safe and scoped.
- Exclude `/api/**` and `/uploads/**` from broad precache/runtime caches unless a task intentionally designs a safe strategy.
- Cache invalidation must be deterministic across releases.
- Offline UI must distinguish stale data from fresh synchronized data.
- Service worker updates must not strand users on incompatible frontend/backend contracts.
- Web-push behavior must stay aligned with notification outbox and subscription cleanup.

## Commands

- `cd frontend && npm run build`
- `cd frontend && npm run build:check`
- `cd frontend && npm run verify:env:prod`
- `npm run test:e2e:preflight`

## Checks

- Use browser testing for installability, service worker registration, offline fallback, and cache behavior when PWA behavior changes.
- Confirm sensitive tenant data is not cached across users, roles, or properties.

