# ADR-009: TanStack Query — Incremental Data Layer Modernization

**Date:** 2026-04-03  
**Status:** Accepted (Phase 1)  
**Addresses:** A-10 (Deep Audit 2026-04-02)

## Context

The application fetched data in two distinct patterns:

1. **SSE live sync** (`useLiveSync.js`) — streams requests, chat, users, blacklist, perms, templates
   in real-time via Server-Sent Events. Already well-optimized with `startTransition` (A-15).

2. **One-shot fetches** — data that is NOT covered by the SSE stream (visit logs, QR validation
   results). These used manual `useState` / `useEffect` / `useCallback` patterns with no
   standardized retry, caching, or stale policy.

The audit item A-10 called for standardized fetch/cache/retry/stale policies across the data layer.
A full big-bang migration of AppStore's 6 contexts would require feature flags, dual test coverage,
and incremental module-by-module rollout — too risky for a single iteration.

## Decision

**Phase 1 (this ADR):** Install `@tanstack/react-query` and migrate **one-shot fetches only**.
Keep the SSE-driven AppStore contexts unchanged.

### QueryClient defaults (aligned with existing `apiClient` behavior)

```js
new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      staleTime: 60_000,   // 1 min — visit logs don't change in real-time
      gcTime: 5 * 60_000,  // garbage-collect after 5 min of inactivity
    },
  },
})
```

Retry count (2) and delay schedule match `apiClient`'s existing exponential backoff + jitter.

### `useVisitLogs` — first migrated query

`VisitLogView` previously managed fetch lifecycle manually:

```js
// Before: 14 lines of boilerplate
const [visitEvents, setVisitEvents] = useState([]);
const [isLoading, setIsLoading]     = useState(true);
const loadLogs = useCallback(() => { ... getVisitLogs().then(...).catch(...) }, []);
useEffect(() => loadLogs(), [loadLogs]);
```

After A-10:

```js
// After: single hook call
const { data: visitEvents = [], isLoading, isError } = useVisitLogs();
const clearLogs = useClearVisitLogs();
```

Benefits:
- Automatic retry on network failure (2× with backoff)
- Stale-while-revalidate: cached data shown instantly, refetch in background
- `invalidateQueries` after `clearVisitLogs` triggers automatic refetch — no manual `loadLogs()`
- Error state (`isError`) surfaces to UI via `StateBlock type="error"`

### Architecture boundary

```
SSE stream  →  useLiveSync.js  →  AppStore contexts  →  useRequests/useUsers/…
                                                         (unchanged, owned by AppStore)

One-shot fetches  →  useQuery hooks  →  QueryClient cache
                                        (new, owned by @tanstack/react-query)
```

The two layers do not share cache. If SSE delivers a visit log event in the future, the
visit-logs query can be invalidated via `queryClient.invalidateQueries(['visitLogs'])` in the
SSE handler without any AppStore changes.

## Trade-offs

- `QueryClientProvider` wraps the entire app — minimal overhead, required for `useQuery` hooks.
- SSE-driven contexts are NOT migrated in Phase 1; they already work correctly.
- Visit log stale time (60s) means a concurrent browser tab may see data up to 60s old.
  This is acceptable — visit logs are an audit trail, not a real-time operational view.

## Phase 2 (planned)

Incrementally migrate AppStore slices that do not receive SSE updates (e.g., perms, templates,
blacklist) to `useQuery` with appropriate `staleTime` and SSE-triggered `invalidateQueries`.
Each slice is an independent migration with its own PR and integration test.

## Consequences

- `VisitLogView` is simpler: −14 lines of boilerplate, +3 lines of hook usage.
- Retry and error handling are standardized — no ad-hoc `.catch(() => { /* ignore */ })`.
- The project now has `@tanstack/react-query` as a dependency — future query migrations
  are zero-setup.
