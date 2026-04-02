# Phase 0 Reliability Progress (step-by-step)

**Date:** 2026-04-02  
**Goal:** Close backend reliability blockers incrementally without large refactors.

## Completed in this iteration

### 1) Auth/CSRF stabilization (already merged in previous steps)
- `AUTH_SKIP_ACTIVE_CHECK` test toggle wired in auth middleware (explicit env-based behavior).
- CSRF verification uses timing-safe compare with hex primary path and legacy plain-token fallback.
- Test suites stabilized for:
  - `csrf.test.js`
  - `fixes.test.js`
  - `templates.test.js`
  - `visitLogs.test.js`
  - `chat.test.js`

### 2) New stabilization in current step
- `auth.test.js`
  - Added missing mock for refresh legacy fallback delete-path (reuse old refresh token flow).
  - Added explicit `AUTH_SKIP_ACTIVE_CHECK=0` pin for deterministic auth behavior.
  - Added `requireAuth.__clearUserActiveFallbackCache()` in `/auth/me` tests to avoid cross-test cache leakage.
- `migrations.test.js`
  - Updated “already applied migrations” fixture with `004_composite_indexes`.

---

## Verified green pack (current)

```bash
npm --prefix backend test -- \
  src/__tests__/csrf.test.js \
  src/__tests__/fixes.test.js \
  src/__tests__/templates.test.js \
  src/__tests__/visitLogs.test.js \
  src/__tests__/chat.test.js \
  src/__tests__/auth.test.js \
  src/__tests__/migrations.test.js
```

**Result:** 7/7 suites passed, 87/87 tests passed.

---

## Remaining red block (next step)

Primary unresolved area:
- `src/__tests__/requests.test.js`
- `src/__tests__/security.test.js` (requests status-transition sub-block)

Working hypothesis:
- these suites still partially assert legacy query flow, while runtime path now goes through `RequestsService.update()` transaction-first pattern (`SELECT ... FOR UPDATE` via `db.pool.connect()` client).

### Planned next iteration
1. Refactor request/security tests to transaction-aware mocks (client query sequence).
2. Align expectations for ownership/transition checks with current service matrix.
3. Re-run full backend suite and split remaining failures into:
   - contract mismatch,
   - test harness mismatch,
   - actual runtime defects.

