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

## Dashboard panels

- Refresh requests/success/fail rates
- Legacy fallback usage (daily)
- DB pool total/idle/waiting
- Active SSE connections and reconnect trends
