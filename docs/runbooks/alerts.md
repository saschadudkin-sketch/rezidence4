# Alert runbook

## RezAuthRefreshFailuresHigh

1. Check application logs for refresh errors (`rez_auth_refresh_failed_total`) and top failing endpoints.
2. Verify DB/Redis connectivity and token signing configuration in the backend.
3. If issue started after a deploy, rollback and compare auth-related changes.

## RezAuthLegacyFallbackUsed

1. Confirm `REFRESH_LEGACY_FALLBACK_ENABLED` is still required for an active migration.
2. Identify accounts/services still using legacy refresh rows.
3. Plan cleanup and switch `REFRESH_LEGACY_FALLBACK_ENABLED=0` after `increase(rez_auth_refresh_legacy_fallback_total[1d]) == 0` for a full day.

## RezDbPoolWaitingHigh

1. Check DB load and long-running queries.
2. Verify backend connection pool size and current traffic.
3. Scale backend/database or tune query/index performance to reduce `rez_db_pool_waiting`.
