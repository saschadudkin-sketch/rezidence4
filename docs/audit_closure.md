# Audit Closure Matrix

This document maps the senior audit findings to concrete implementation and tests in the repository.

## Critical

### 1) Users hard-delete risk
- **Status:** ✅ Closed
- **Implementation:**
  - Users are soft-deleted (`deleted_at`) and soft-delete also updates `updated_at`.
  - User updates ignore deleted rows (`AND deleted_at IS NULL`).
  - Auth middleware rejects deleted users even with valid JWT.
- **Key files:**
  - `backend/src/routes/users.js`
  - `backend/src/middleware/auth.js`
- **Tests:**
  - `backend/src/__tests__/users.test.js`
  - `backend/src/__tests__/middleware_auth.test.js`
  - `backend/src/__tests__/auth.test.js`

## Important

### 2) Request correlation id across request → refresh → retry
- **Status:** ✅ Closed
- **Implementation:**
  - One operation-level `X-Request-Id` reused across primary request and refresh call.
- **Key files:**
  - `frontend/src/services/http/apiClient.js`
  - `frontend/src/services/http/authSession.js`
- **Tests:**
  - `frontend/src/services/providers/apiClient.test.js`

### 3) Retry backoff linear / synchronized retries
- **Status:** ✅ Closed
- **Implementation:**
  - Exponential backoff with cap implemented.
  - Full jitter added for retry delay distribution.
- **Key files:**
  - `frontend/src/services/http/retryPolicy.js`
  - `frontend/src/services/http/apiClient.js`
- **Tests:**
  - `frontend/src/services/providers/apiClient.test.js`

### 4) OpenAPI contract test too strict for 204/non-json
- **Status:** ✅ Closed
- **Implementation:**
  - Contract smoke now skips 204 schema/content enforcement.
  - Schema enforcement kept strict for `application/json` only.
- **Key files:**
  - `backend/src/__tests__/api_contract.test.js`
- **Tests:**
  - `backend/src/__tests__/api_contract.test.js`

### 5) SSE event-id process-local semantics
- **Status:** ✅ Closed
- **Implementation:**
  - Event IDs based on `Date.now() + randomUUID()`.
  - Added restart simulation test ensuring uniqueness across module reload.
- **Key files:**
  - `backend/src/sse.js`
  - `backend/src/__tests__/sse.test.js`

### 6) Offline banner accessibility (ARIA live)
- **Status:** ✅ Closed
- **Implementation:**
  - `role="status"`, `aria-live="polite"`, `aria-atomic="true"` applied.
- **Key files:**
  - `frontend/src/App.jsx`

## Architecture / Maintainability

### 7) Overloaded frontend API client
- **Status:** ✅ Closed
- **Implementation:**
  - Decomposed into transport / retry policy / auth session / upload / identity modules.
  - Backward-compatible provider facade maintained.
- **Key files:**
  - `frontend/src/services/http/*`
  - `frontend/src/services/providers/apiClient.js`

## Notes
- This matrix is intentionally implementation-focused and maps each audit point to code + tests.
- For production sign-off, run full backend/frontend test suites in CI and smoke-run API docs validation.
