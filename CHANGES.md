# AUDIT-3 Fixes — Applied Changes

All 15 bugs found in the third audit have been fixed. Below is a precise log
of what was changed and why.

---

## CRITICAL fixes (production-blocking)

### FIX-1 · `app.set('trust proxy', 1)` — rate limiting now works behind nginx
**File:** `backend/src/index.js`  
**Problem:** Without trust proxy, Express sees all requests as coming from the
Docker bridge IP (`172.17.0.x`). The rate limiter counted hits per proxy, not
per real client — effectively disabling it for everyone.  
**Fix:** `app.set('trust proxy', 1)` added immediately after `express()`.

---

### FIX-2 · `DATABASE_URL` startup validation
**File:** `backend/src/index.js`  
**Problem:** Missing `DATABASE_URL` only caused obscure runtime errors on the
first SQL query, not a clear startup failure.  
**Fix:** `process.exit(1)` with a descriptive message if `DATABASE_URL` is absent.

---

### FIX-3 · `token_revocations` cleanup job (hourly)
**File:** `backend/src/index.js`  
**Problem:** Every logout inserted a row into `token_revocations`. No cleanup
existed — the table grew forever. Every authenticated request queried it.  
**Fix:** `setInterval` runs `DELETE … WHERE expires_at < NOW()` every hour.
Uses `.unref()` so it doesn't block graceful shutdown.

---

### FIX-4 · `ioredis` added to `package.json`
**File:** `backend/package.json`  
**Problem:** `middleware/idempotency.js` called `require('ioredis')` but the
package was not declared. `npm ci` in Docker silently fell back to in-memory
mode — idempotency didn't work in multi-replica deployments.  
**Fix:** `"ioredis": "^5.3.2"` added to `dependencies`.

---

## IMPORTANT fixes

### FIX-5 · `Idempotency-Key` length validation
**File:** `backend/src/middleware/idempotency.js`  
**Problem:** No length check on the header value. An attacker could send a 1 MB
key → Redis key = 1 MB → potential OOM or slow writes.  
**Fix:** Returns `400` if key is not a string or exceeds 256 characters.

---

### FIX-6 · Upload quota counts actual photos, not requests
**File:** `backend/src/routes/upload.js`  
**Problem:** Quota counted *requests that have photos*, not the number of
photos. A user could attach 50 photos to one request and bypass the limit.  
**Fix:** `SUM(array_length(photos, 1))` counts actual photos. Limit raised to
200 photos total per user.

---

### FIX-7 · `DELETE /api/visit-logs` requires explicit confirmation
**File:** `backend/src/routes/visitLogs.js`  
**Problem:** A single admin API call wiped the entire visit log history with no
confirmation or audit trail.  
**Fix:** Request body must contain `{ "confirm": "DELETE_ALL_LOGS" }`. The
deleted row count is logged via pino.

---

### FIX-8 · `request_snapshot` removed from visit-logs list endpoint
**File:** `backend/src/routes/visitLogs.js`  
**Problem:** Each `request_snapshot` JSONB field could be up to 50 KB.
Returning 100 records = up to 5 MB per list response.  
**Fix:** List (`GET /`) no longer returns `request_snapshot`. Added new
`GET /:id` endpoint that returns the full record including snapshot.

---

### FIX-9 · Chat cursor pagination uses composite `(at, id)` cursor
**File:** `backend/src/routes/chat.js`  
**Problem:** `WHERE at < cursor_at` skips one of two messages sent within the
same millisecond — a realistic scenario in active chats.  
**Fix:** `WHERE (at, id) < (SELECT at, id FROM … WHERE id = $1)` with
`ORDER BY at DESC, id DESC`.

---

### FIX-10 · Backup script compatible with Alpine busybox `date`
**File:** `docker-compose.yml`  
**Problem:** `date -d 'tomorrow 03:00'` (GNU) and `date -v+1d` (BSD) both fail
on Alpine's busybox `date`. The backup container never ran.  
**Fix:** Replaced with a simple `sleep 86400` loop — compatible with any POSIX
shell. First backup runs 60 seconds after container start.

---

### FIX-11 · Backward-compatible route aliases get `authLimiter` + `Deprecation` header
**File:** `backend/src/index.js`  
**Problem:** `/api/auth` had a rate limiter but `/api/v1/auth` did not inherit
it (and vice-versa). The unversioned aliases were "temporary" since the previous
audit with no enforcement mechanism.  
**Fix:** A `deprecate` middleware adds `Deprecation` and `Sunset` headers to
all unversioned routes. `/api/auth` explicitly re-applies `authLimiter`.

---

### FIX-12 · `useAppState()` throws in production
**File:** `frontend/src/store/AppStore.jsx`  
**Problem:** The deprecated hook only `console.warn`-ed in development. In
production the warning was silent — any new usage of the hook would silently
subscribe to all 6 contexts, undoing the context-splitting optimisation.  
**Fix:** `throw new Error(…)` in production so `ErrorBoundary` catches it
immediately. Dev keeps the console warning.

---

### FIX-13 · `OfflineBanner` uses CSS `transform` — no layout shift
**File:** `frontend/src/App.jsx`  
**Problem:** The banner was conditionally mounted (`{!isOnline && <Banner />}`).
Mounting/unmounting caused an instant 36 px layout jump, especially jarring on
mobile for security staff.  
**Fix:** Banner is always mounted. `transform: translateY(-100% / 0)` with
`transition: 220ms ease` slides it in/out smoothly. `padding-top` also
transitions at the same duration.

---

### FIX-14 · Helmet CSP disabled on backend (API-only server)
**File:** `backend/src/index.js`  
**Problem:** The backend sent its own `Content-Security-Policy` header on every
API response. The frontend nginx also sends CSP. Browsers apply both —
whichever is stricter wins — causing hard-to-diagnose breakage of SSE or photo
uploads in production without a clear error.  
**Fix:** `contentSecurityPolicy: false` in helmet config. The backend is an
API server (JSON only). CSP belongs exclusively in `frontend/nginx.conf`.

---

### FIX-15 · Composite index `(at DESC, id DESC)` added to `chat_messages`
**File:** `backend/src/db.js`  
**Problem:** The new cursor query `WHERE (at, id) < (…) ORDER BY at DESC, id DESC`
had no matching index. Postgres would fall back to a sequential scan on the
entire `chat_messages` table.  
**Fix:** `CREATE INDEX IF NOT EXISTS idx_chat_at_id ON chat_messages(at DESC, id DESC)`
added to migrations. The old `idx_chat_at` is kept for backward compatibility
with any existing queries that only filter on `at`.

---

## Summary

| # | File | Category | Severity |
|---|------|----------|----------|
| 1 | `backend/src/index.js` | Rate limiting | 🔴 Critical |
| 2 | `backend/src/index.js` | Startup validation | 🔴 Critical |
| 3 | `backend/src/index.js` | DB / cleanup | 🟡 Important |
| 4 | `backend/package.json` | Dependency | 🔴 Critical |
| 5 | `backend/src/middleware/idempotency.js` | Security / DoS | 🟡 Important |
| 6 | `backend/src/routes/upload.js` | Logic bug | 🟡 Important |
| 7 | `backend/src/routes/visitLogs.js` | Data safety | 🟡 Important |
| 8 | `backend/src/routes/visitLogs.js` | Performance | 🟡 Important |
| 9 | `backend/src/routes/chat.js` | Data correctness | 🟡 Important |
| 10 | `docker-compose.yml` | DevOps | 🟡 Important |
| 11 | `backend/src/index.js` | Security / rate limit | 🟡 Important |
| 12 | `frontend/src/store/AppStore.jsx` | Correctness | 🟡 Important |
| 13 | `frontend/src/App.jsx` | UX | 🟠 Nice to have |
| 14 | `backend/src/index.js` | Security / CSP | 🟡 Important |
| 15 | `backend/src/db.js` | Performance | 🟡 Important |
