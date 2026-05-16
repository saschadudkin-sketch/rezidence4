# DomHub — Analytics Metric Definitions

Дата: 2026-04-21  
Статус: рабочая metric definitions specification  
Назначение: определить, какие KPI и operational metrics использует DomHub и как они считаются.

---

## 1. Цель документа

Документ нужен, чтобы:
- все команды одинаково понимали метрики;
- dashboard, exports и reporting считали одно и то же;
- избежать “разных правд” между backend, frontend и sales/demo.

---

## 2. Общие правила

### 2.1 Источник истины

Метрики должны считаться из:
- `property DB` событий и operational records;
- агрегироваться безопасно для `management_company` и platform views.

### 2.2 Tenant boundary

По умолчанию:
- object-level metrics = одна property DB
- portfolio metrics = aggregation across allowed properties

### 2.3 Временная зона

Все time-based metrics должны считаться в timezone объекта, если явно не указано иное.

---

## 3. Core access metrics

## 3.1 Access Requests Created

**Определение:** количество созданных `access_request` за период.

Формула:
- count of `access_requests.created_at` within period

Разрезы:
- by property
- by request type
- by subject type

## 3.2 Access Approval Rate

**Определение:** доля access requests, которые были одобрены.

Формула:
- approved requests / (approved + rejected requests)

Примечание:
- cancelled requests не включаются в denominator unless explicitly needed in a separate metric.

## 3.3 Access Denial Count

**Определение:** количество deny events за период.

Формула:
- count of `visit_logs.event_type in ('entry_denied', 'exit_denied', 'manual_deny')`

## 3.4 Access Allow Count

**Определение:** количество разрешённых проходов/въездов за период.

Формула:
- count of `visit_logs.event_type in ('entry_allowed', 'exit_allowed', 'manual_admit', 'override')`

## 3.5 QR Pass Usage Count

**Определение:** количество использованных QR passes.

Формула:
- count of passes where `pass_type in relevant QR-enabled types` and status transitioned to `used`

## 3.6 Vehicle Traffic Count

**Определение:** число событий, связанных с транспортом.

Формула:
- count of visit_logs where `vehicle_plate is not null`

## 3.7 Access Point Allow/Deny Count

**Определение:** allow/deny события по физической точке доступа.

Формула:
- group `visit_logs_v2` by `access_point_id` within the selected dashboard period;
- allow = `event_type in ('entry_allowed','exit_allowed','manual_admit','override')`;
- deny = `event_type in ('entry_denied','exit_denied','manual_deny')`.

Tenant scope: one property DB; management-company rollup sums only properties in the allowed portfolio.

## 3.8 Deny Reasons

**Определение:** причины отказов, видимые в операционном dashboard.

Формула:
- for deny events in `visit_logs_v2`, use first non-empty value from:
  - `provider_payload.reason`;
  - `provider_payload.degraded_reason`;
  - fallback `event_type`.

Null behavior: empty reason values are not shown as separate hidden buckets.

## 3.9 Peak Traffic Windows

**Определение:** часы с максимальной нагрузкой по access events.

Формула:
- count `visit_logs_v2` by `date_trunc('hour', occurred_at)` within the selected period;
- dashboard shows the top windows by total count.

Time scope: object-local timezone should be used once tenant timezone is persisted; current implementation stores ISO timestamps from PostgreSQL and documents the window start.

## 3.10 Average Guard Decision Time

**Определение:** средняя задержка записи manual guard decision where measurable.

Формула:
- average seconds between `visit_logs_v2.created_at` and `visit_logs_v2.occurred_at`;
- includes only `manual_admit`, `manual_deny`, `override`;
- excludes rows where `created_at < occurred_at`.

This is an operational recording/processing proxy, not a biometric or behavioral performance score.

## 3.11 Offline Replay Count

**Определение:** количество replay events, которые пришли из degraded/offline guard flow.

Формула:
- count `security_offline_replay_events.occurred_at` within period;
- breakdown by `replay_status`.

## 3.12 Trusted Visitor Usage

**Определение:** использование resident-owned trusted visitor templates.

Формула:
- active templates = count `trusted_visitors.is_active = true`;
- usage = count `access_requests` with `trusted_visitor_id is not null` created within period.

## 3.13 SKUD Failure And Manual-Control Count

**Определение:** operational health of SKUD provider and manual fallback use.

Формула:
- provider failures = count `skud_integration_events.status in ('failed','retrying','dead_lettered')`;
- manual control = count `hardware_manual_control_events.created_at` within period.

---

## 4. Incident and security metrics

## 4.1 Open Incidents

**Определение:** количество access incidents со статусами `open` or `investigating`.

## 4.2 Incident Resolution Time

**Определение:** медианное время от `incident.created_at` до `resolved_at`.

Формула:
- median(`resolved_at - created_at`) for resolved incidents

## 4.3 Manual Override Count

**Определение:** количество `access_override` за период.

Разрезы:
- by property
- by staff
- by override type

## 4.4 Blacklist Hit Count

**Определение:** количество incidents/events, связанных с blacklist hits.

Формула:
- count of incidents with `incident_type = 'blacklist_hit'`

## 4.5 Suspicious Attempt Count

**Определение:** количество подозрительных повторных/аномальных попыток прохода.

Формула:
- count of incidents with `incident_type = 'suspicious_repeat_attempt'`

---

## 5. Requests and operations metrics

## 5.1 Requests Created

Count of `requests.created_at` within period.

## 5.2 Requests Completed

Count of requests transitioned to `completed` within period.

## 5.3 First Response Time

Median of:
- `first_response_at - created_at`

Only for requests where `first_response_at` exists.

## 5.4 Resolution Time

Median of:
- `resolved_at - created_at`

Only for requests where `resolved_at` exists.

## 5.5 SLA Compliance Rate

**Определение:** доля requests, resolved within `sla_due_at`.

Формула:
- resolved within SLA / all resolved requests with SLA

## 5.6 Overdue Backlog

**Определение:** число открытых requests, у которых `now > sla_due_at`.

---

## 6. Contractor and technician metrics

## 6.1 Assigned Requests Count

Number of requests assigned to a technician or contractor.

## 6.2 Technician Resolution Count

Count of requests resolved by technician.

## 6.3 Contractor Resolution Count

Count of requests resolved by contractor.

## 6.4 Contractor Access Volume

Count of contractor-related access requests / passes / visits.

## 6.5 Workload by Assignee

Open assigned requests count by staff/contractor.

---

## 7. Resident adoption metrics

## 7.1 Resident Activation Rate

Activated residents / total imported or provisioned residents.

## 7.2 Resident Self-Service Access Share

Share of access requests created by resident self-service vs staff-created.

## 7.3 Resident Request Self-Service Share

Share of service requests created directly by resident.

---

## 8. Notification metrics

## 8.1 Notification Sent Count

Count of notification log records created.

## 8.2 Notification Delivery Success Rate

sent with status success / total attempted, per channel.

## 8.3 Notification Failure Count

Count of failed notification attempts per channel/provider/property.

---

## 9. Portfolio metrics for management company

## 9.1 Properties Active

Count of active properties in the portfolio.

## 9.2 Portfolio Access Volume

Sum of object-level access requests / visits across allowed properties.

## 9.3 Portfolio Incident Load

Count of open incidents across properties.

## 9.4 Portfolio SLA Compliance

Weighted or simple aggregated SLA compliance across properties.  
Implementation choice must be documented in dashboard UX.

## 9.5 Hotspot Property Count

Count of properties breaching defined thresholds, e.g.:
- incident spike
- high overdue backlog
- low notification delivery success

---

## 10. Export rules

Exports must use the same formulas as dashboards.

CSV exports should support:
- property analytics
- access events
- incidents
- requests
- vehicle traffic
- notification health

## 10.1 DH-45 materialized KPI snapshots

Backend baseline:
- `analytics_kpi_snapshots` stores per-property `operations_dashboard` snapshots for `24h`, `7d`, and `30d` windows.
- `payload` contains the same formula output used by the DH-35 operational dashboard.
- `flat_rows` contains CSV/export-ready metric rows with `metric_group`, `metric_key`, `value`, `unit`, and JSON `dimensions`.
- `/api/v1/analytics/snapshots` materializes snapshots manually for admins.
- `/api/v1/analytics/snapshots/latest?format=csv` exports the latest materialized rows.
- `ANALYTICS_AGGREGATION_ENABLED=true` starts the periodic runner; in multi-tenant mode it only processes active properties whose package and feature flags resolve `analytics=true`.

Open later work:
- canonical event-sourced rollups beyond the current DH-35 formula source;
- advanced BI/query builder tooling;
- staff/contractor performance analytics beyond the current KPI set.

---

## 11. Metric quality rules

Every metric must have:
- name
- human-readable definition
- formula
- source fields
- tenant scope
- time scope
- exclusions/inclusions

No dashboard metric should exist without a written definition.

---

## 12. Related documents

This document depends on:
- `domhub-access-data-model-spec.md`
- `domhub-state-machines-spec.md`
- `domhub-access-api-contract-spec.md`
- `domhub-test-strategy-spec.md`

The next adjacent useful document is:
- `domhub-packaging-and-feature-gating-spec.md`

