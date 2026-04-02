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


---

## Phase 0 status

**Status: COMPLETED** for backend reliability gate in current repository state.

### Completion criteria achieved
- Full backend test suite green: `28/28` suites, `354/354` tests.
- Previously unstable auth/csrf/requests/chat/perms/blacklist/upload/migrations packs now deterministic.

---

## Что дальше по плану (следующие 2 недели)

### Week 1 — Phase 1 kickoff (UX clarity + error-state system)
1. **Login UX uplift spec**
   - Stepper 1/2, inline validation, resend timer, error microcopy.
2. **StateBlock design + API**
   - единый компонент состояния: `loading / empty / error / retry`.
3. **Navigation parity spec**
   - mobile badges с count-cap (`9+`) вместо бинарных dot-сигналов.

### Week 2 — реализация первых product-facing изменений
1. Внедрить `StateBlock` в:
   - requests list,
   - chat list,
   - visit logs.
2. Переписать login flow на inline-errors + retry timer.
3. Добавить e2e smoke:
   - login success/failure/retry,
   - partial API failure + retry action.

### Governance / CI immediately
- Зафиксировать отдельные CI-джобы:
  - `backend:test` (полный),
  - `frontend:test`,
  - `frontend:build` c env preflight,
  - `contract-pack` как required check.


---

## Phase 1 progress (current)

### Уже сделано
- Login UX uplift v1:
  - step indicator (1/2),
  - inline field errors,
  - resend timer и повторная отправка кода.
- Unified state component:
  - создан `StateBlock`,
  - интегрирован в `VisitLogView` для loading/empty.

### Что дальше по плану (следующая итерация)
1. **StateBlock rollout в остальные критичные потоки**
   - requests list,
   - chat list,
   - минимум один admin-list экран.
2. **Navigation semantics parity (mobile vs desktop)**
   - заменить dot-индикаторы на count badges с cap `9+`,
   - унифицировать приоритеты бейджей.
3. **Login flow hardening**
   - добавить e2e smoke на resend/invalid code/retry,
   - ввести метрическую телеметрию: login success/fail/retry.
4. **CI quality gates for UX changes**
   - обязательный прогон targeted frontend tests для изменённых view-компонентов,
   - regression checklist по loading/empty/error states.

