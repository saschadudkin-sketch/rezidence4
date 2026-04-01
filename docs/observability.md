# Observability playbook

## Legacy refresh fallback mode

- Secure default: `REFRESH_LEGACY_FALLBACK_ENABLED=0`.
- Temporary migration scenario: set `REFRESH_LEGACY_FALLBACK_ENABLED=1` only for the migration window to consume old refresh rows stored by raw token id.
- Exit criteria: when `increase(rez_auth_refresh_legacy_fallback_total[1d]) == 0` for a full day, switch back to `0`.

## Prometheus alerts

### 1. Refresh failures spike
```yaml
- alert: RezAuthRefreshFailuresHigh
  expr: rate(rez_auth_refresh_failed_total[5m]) > 0.2
  for: 10m
  labels: { severity: warning }
  annotations:
    summary: "Auth refresh failures elevated"
```

### 2. Legacy fallback still used after sunset
```yaml
- alert: RezAuthLegacyFallbackUsed
  expr: increase(rez_auth_refresh_legacy_fallback_total[1d]) > 0
  for: 0m
  labels: { severity: critical }
  annotations:
    summary: "Legacy refresh fallback still used"
```

### 3. DB pool saturation
```yaml
- alert: RezDbPoolWaitingHigh
  expr: rez_db_pool_waiting > 5
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "PostgreSQL pool waiting queue is growing"
```


## Rule files and runbook

- Alert rules: [`ops/alerts/auth.rules.yml`](../ops/alerts/auth.rules.yml), [`ops/alerts/db.rules.yml`](../ops/alerts/db.rules.yml)
- Runbook: [`docs/runbooks/alerts.md`](./runbooks/alerts.md)
- Consistency check script: `node ops/check_observability_consistency.js`

## CI enforcement

- Workflow job: `observability-consistency` in `.github/workflows/ci.yml`.
- The job fails CI if:
  1) an alert from `ops/alerts/*.rules.yml` is missing in `docs/runbooks/alerts.md`, or
  2) `docs/observability.md` is missing rule-file/runbook references.

## Dashboard panels

- Refresh requests/success/fail rates
- Legacy fallback usage (daily)
- DB pool total/idle/waiting
- Active SSE connections and reconnect trends

## Alert ownership and routing

| Area | Primary owner | Secondary owner | Escalation channel |
|---|---|---|---|
| Auth/refresh errors | Backend on-call | Platform on-call | `#inc-auth` |
| DB saturation/latency | Platform on-call | Backend on-call | `#inc-db` |
| SSE reconnect anomalies | Backend on-call | Frontend on-call | `#inc-realtime` |
| Frontend retry storms | Frontend on-call | Backend on-call | `#inc-web` |

### Routing conventions

- `severity=critical` -> page primary owner immediately, notify secondary owner.
- `severity=warning` -> notify owner channel and create triage task within business hours.
- Any alert firing > 30m requires incident ticket and runbook link in timeline.

## SLO references

- **Auth refresh success ratio SLO:** >= 99.5% over 30d rolling window.
- **API availability SLO (core routes):** >= 99.9% over 30d.
- **SSE delivery health objective:** reconnect error ratio < 1% over 1h windows.

When changing thresholds, update both:
1) alert rule in `ops/alerts/*.rules.yml`, and  
2) this file + incident runbook links.
