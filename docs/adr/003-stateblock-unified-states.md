# ADR-003: StateBlock — Unified Widget State Pattern

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-08 (Deep Audit 2026-04-02)

## Context

Before this change, loading/empty/error states were handled ad-hoc in each view: some showed a spinner, others rendered nothing, some showed a text message. There was no standard retry affordance. Users couldn't tell if a missing list was empty or an error.

## Decision

Introduce `src/ui/StateBlock.jsx` — a single component for rendering `loading | empty | error | retry` states in any list/widget:

```jsx
<StateBlock
  type="error"
  title="Не удалось загрузить данные"
  subtitle="Проверьте соединение"
  actionLabel="Повторить"
  onAction={reload}
/>
```

Props:
- `type`: `'loading' | 'empty' | 'error'`
- `title`, `subtitle`: explanatory text
- `actionLabel`, `onAction`: optional retry button

## Rollout

Deployed in 26+ locations across: requests list, visit log, blacklist, permissions, concierge/security views, resident view, chat.

## Consequences

- All key screens follow a consistent state model.
- Users see actionable retry buttons when data fails to load.
- Fewer ad-hoc empty/loading patterns to maintain.
- Future: extend `type` with `'offline'` state when offline-banner pattern matures.
