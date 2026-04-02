# ADR-001: Dashboard Shell Decomposition

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-01 (Deep Audit 2026-04-02)

## Context

`Dashboard.jsx` was a god component (~350 lines) orchestrating header, navigation, avatar menu, role-based view switching, and all live-sync hooks. This made it hard to evolve UX patterns (onboarding, wizard flows, role-specific IA) without risking regressions in unrelated zones.

## Decision

Extract four focused shell components under `src/views/shell/`:

| Component | Responsibility |
|---|---|
| `AppShell` | Outer layout: header + content area. Composes the other shells. |
| `NavigationShell` | Top-nav (desktop) + mobile-nav. Badge rendering with count caps. |
| `RoleContentRouter` | Lazy-loaded role-based view switching (formerly `RenderContent`). |
| `UserMenu` | Header user button, dropdown menu, avatar modal trigger. |

`Dashboard.jsx` becomes a thin coordinator: runs hooks, computes derived state, passes props to `AppShell`.

## Consequences

- Each shell component is independently testable.
- Future UX patterns (onboarding wizard, role-specific top-bar actions) can be added to the relevant shell without touching Dashboard.
- `RoleContentRouter` can later be extended with route-based navigation without a full rewrite.
- Props surface of AppShell is explicit — no implicit state sharing.

## Migration notes

- All FIX/PERF/UX inline comments from the original Dashboard were removed from code. Historical context lives in this ADR and CHANGES.md.
- The `RenderContent` memo was renamed to `RoleContentRouter` for clarity.
