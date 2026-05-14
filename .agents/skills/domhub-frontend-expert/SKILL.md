---
name: domhub-frontend-expert
description: Use when changing DomHub frontend code under frontend/src, especially React views, selector-store state, React Query services, role workspaces, design-system components, sync feedback, and UI governance checks.
license: project-local
metadata:
  domain: frontend
  project: DomHub
  source: project-local
---

# DomHub Frontend Expert

Use this skill for frontend implementation, review, debugging, or test work in `frontend/`.

## Architecture Rules

- `frontend/` uses a selector-based store with bounded contexts. Prefer selectors for derived collections instead of recomputing in views.
- Keep views focused on composition, rendering, and interaction. Push data access into services/providers and domain rules into domain modules.
- Align role workspaces with product specs and existing navigation shell behavior.
- Use `/api/v1/*` contracts. Do not add new calls to deprecated `/api/*` aliases.
- Treat initial hydrate and SSE updates as separate UI states.

## UI Rules

- Reuse `frontend/src/design-system`, `frontend/src/ui`, and established view patterns before adding new components.
- Operational dashboards should be dense, scannable, and restrained, not marketing-style pages.
- Preserve responsive behavior, modal accessibility, state blocks, loading/error/empty states, and copy tone.

## Testing

Prefer targeted checks for touched files:

- `cd frontend && npm run lint`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run test`
- `cd frontend && npm run verify:all` for broad UI or architecture changes.

Use Vitest and Testing Library patterns already present in `frontend/src/**/*.test.tsx`. Use MSW or existing service providers instead of brittle network mocking when possible.

