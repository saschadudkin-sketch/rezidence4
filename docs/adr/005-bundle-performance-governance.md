# ADR-005: Bundle Budget & Performance Governance

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-07 (Deep Audit 2026-04-02)

## Context

Performance optimizations (React.memo, lazy, useCallback) were applied reactively on a case-by-case basis with no measurable budget or CI gate. Bundle size had no enforced limit, meaning regressions could accumulate undetected.

## Decision

### Bundle budget gates (vite.config.js)

- `chunkSizeWarningLimit: 300` KB — Vite warns when any chunk exceeds 300 KB.
- `manualChunks` entries split vendor code into stable, cache-friendly chunks:
  - `vendor-react` — react + react-dom
  - `vendor-qr` — qrcode library

### Architecture-level lazy loading

Role-specific views (`ResidentView`, `SecurityView`, `ConciergeView`, `AdminView`) are all lazy-loaded via `React.lazy()` in `RoleContentRouter`. A user loading the app as a resident never downloads the admin or security bundles.

### Future governance rules

1. New UI libraries must have a bundle impact estimate before merge.
2. Any chunk exceeding 300 KB requires justification in PR description.
3. Core navigation/auth path must stay below 150 KB (gzipped).
4. Perf profiling of chat and request list views before each release.

## Consequences

- CI build will warn on bundle regressions.
- Vendor chunks are stable across deploys → better CDN cache hit rate.
- Engineers have a clear budget to work within.
- Next: add `rollup-plugin-visualizer` for visual bundle inspection in dev builds.
