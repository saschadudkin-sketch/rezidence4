# Incident Playbook — Audit Fixes

Operational playbook for common incidents after rollout of auth/refresh/retry/SSE changes.

## 1) 401 storm after deploy

### Symptoms
- Sudden increase in 401 responses.
- Frontend repeatedly emits unauthorized events.
- Spike in `/api/auth/refresh` failures.

### Immediate checks
1. Verify `JWT_SECRET` consistency across backend instances.
2. Check Redis availability and latency.
3. Confirm DB reachability for fallback revocation checks and `users` lookup.
4. Check whether affected users are soft-deleted (`deleted_at IS NOT NULL`).

### Mitigation
- If caused by stale token verification config mismatch: rollback config/deploy.
- If caused by Redis outage + DB overload: scale DB read capacity and enable temporary rate controls.
- If caused by mass user deactivation mistake: restore user state via controlled DB rollback procedure.

---

## 2) Refresh loop / refresh fail cascade

### Symptoms
- Many `POST /api/auth/refresh` requests per client session.
- Users report repeated relogin prompts.

### Immediate checks
1. Validate refresh cookie path/samesite/secure attributes in production.
2. Confirm refresh token rotation path deletes old token and inserts a new one.
3. Verify `REFRESH_LEGACY_FALLBACK_ENABLED` setting is intentional.

### Mitigation
- Temporarily enable legacy fallback only if compatibility incident is confirmed.
- Revert recent cookie/security policy changes if they broke refresh cookie delivery.
- If DB contention on refresh table is high, add short-term autoscaling and query monitoring.

---

## 3) SSE reconnect flood

### Symptoms
- Many reconnecting EventSource clients.
- Elevated connection churn and memory pressure.

### Immediate checks
1. Confirm SSE endpoint health and upstream timeout settings (ingress/proxy).
2. Verify event-id generation remains UUID-based and unique after restarts.
3. Check client-side reconnect backoff behavior and browser console errors.

### Mitigation
- Reduce proxy idle-timeout mismatch causing forced reconnects.
- Scale horizontally and verify Redis pub/sub propagation if multi-instance.
- Temporarily reduce non-critical SSE payload volume.

---

## 4) Retry burst pressure on backend

### Symptoms
- Backend load spikes during partial outage recovery.
- Increased 429/5xx plus elevated client retry traffic.

### Immediate checks
1. Confirm frontend uses exponential backoff + jitter.
2. Inspect top failing endpoints and status code mix (429 vs 5xx).
3. Verify per-route rate limits and WAF behavior.

### Mitigation
- Increase backend capacity for hot endpoints.
- Tune rate limits to avoid synchronized reject/retry loops.
- Deploy feature flag to reduce optional polling/request volume.

---

## 5) Post-incident validation

- Run focused tests:
  - backend: auth/middleware/users/api_contract/sse suites.
  - frontend: provider apiClient tests.
- Verify logs include stable `X-Request-Id` chains for request->refresh->retry.
- Update `docs/audit_closure.md` and incident timeline with root cause and permanent fix.
