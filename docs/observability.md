# Observability

Этот документ является источником правды и для людей, и для CI-проверяемой конфигурации мониторинга.

## Исполняемая конфигурация

- Правила Prometheus alerting: `infra/monitoring/prometheus/alerts.yml`
- Маршрутизация Alertmanager: `infra/monitoring/alertmanager/alertmanager.yml`
- Runbooks:
  - `docs/runbooks/refresh-fail-spike.md`
  - `docs/runbooks/legacy-fallback-used.md`
  - `docs/runbooks/db-pool-waiting.md`

## Алерты

### 1) Refresh fail spike

- **Alert**: `RezidenceRefreshFailSpike`
- **Metric**: `rezidence_auth_refresh_fail_total`
- **Condition**: `increase(...[5m]) > 20` в течение `5m`
- **Owner**: `team-platform`

### 2) Legacy fallback used

- **Alert**: `RezidenceLegacyFallbackUsed`
- **Metric**: `rezidence_legacy_fallback_total`
- **Condition**: `increase(...[15m]) > 0` в течение `2m`
- **Owner**: `team-backend`

### 3) DB pool waiting

- **Alert**: `RezidenceDbPoolWaiting`
- **Metric**: `rezidence_db_pool_waiting`
- **Condition**: `avg_over_time(...[5m]) > 5` в течение `10m`
- **Owner**: `team-backend`

## Валидация в CI

В CI добавлена проверка:

- `promtool check rules infra/monitoring/prometheus/alerts.yml`
- `amtool check-config infra/monitoring/alertmanager/alertmanager.yml`

Это предотвращает merge невалидной конфигурации оповещений.
