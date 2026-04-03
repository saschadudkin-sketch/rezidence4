# ADR-008: Real-time Update Batching with React Concurrent Features

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-15 (Deep Audit 2026-04-02)

## Context

Live SSE updates (requests, chat, users, blacklist, perms, templates) triggered synchronous React state updates. On low-end devices or during active user interaction (typing a search query, scrolling a list), these updates could cause frame drops and perceived lag.

Additionally, search/filter computations in `VisitLogView` and `AdminView` re-ran on every debounce tick, blocking the rendering of the input field itself.

## Decision

### 1. `startTransition` in `useLiveSync.js`

SSE state updates that are non-urgent (background data refreshes) are wrapped in `startTransition`:

```js
startTransition(() => callbacksRef.current.setAllRequests?.(docs));
```

This tells React: "this update is not urgent — yield to user interactions first."

**Exceptions:** notification and alert logic runs *before* the transition because it's urgent (plays sound, shows system notification).

**Initial bulk load** (first packet from SSE) is NOT wrapped in transition — it should render as fast as possible to replace the loading skeleton.

### 2. `useDeferredValue` for search filters

`VisitLogView` and `AdminView` use `useDeferredValue(debouncedQuery)` before passing `q` to the `useMemo` filter:

```js
const debouncedQuery = useDebounce(query, 150);
const deferredQuery  = useDeferredValue(debouncedQuery);
const q = deferredQuery.trim().toLowerCase();
```

The input renders immediately with the user's typed value; the filtered list re-renders only when React has idle time. This prevents the input from feeling sluggish on large datasets.

Debounce was reduced from 250ms to 150ms because `useDeferredValue` handles the rendering pressure that the extra debounce time was compensating for.

## Trade-offs

- `startTransition` makes list updates slightly delayed (imperceptible — usually one frame) in exchange for guaranteed smooth user input.
- If the SSE stream delivers updates faster than React can process them in the transition queue, React will batch and coalesce the transitions automatically.
- `useDeferredValue` shows stale filtered results briefly while the new filter computes. This is acceptable; the list updates smoothly without jank.

## Consequences

- Typing in search fields is guaranteed to be responsive even when large lists are re-filtering.
- Live SSE updates don't block ongoing user interactions.
- No new dependencies required — uses built-in React 18 concurrent features.
