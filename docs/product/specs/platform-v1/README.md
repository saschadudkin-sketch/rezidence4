# platform-v1 — Module Specs Index

Короткие спецификации (1–2 страницы каждая) для D-lite рефактора. Формат описан в `passes-spec.md §8`.

**Мастер-спека БД:** `../domhub-access-data-model-spec.md`
**Роадмап:** `/ROADMAP.md` в корне репо
**Reconciliation:** `/RECONCILIATION.md` в корне репо

## Готовые спеки (по фазам)

### Фаза 2 — Structure + People

| Модуль | Статус |
|---|---|
| [units](./units-spec.md) | Draft |
| [residents](./residents-spec.md) | Draft |
| [staff-users](./staff-users-spec.md) | Draft |
| [contractors](./contractors-spec.md) | Draft (covers `contractor_companies` + `contractor_users`) |
| [auth-v1](./auth-v1-spec.md) | Draft (§7: `requireAuthV1` middleware deferred до Phase 7) |
| [role-scope-memberships](./role-scope-memberships-spec.md) | Draft (DH-03 bridge: durable subject role/scope assignments + scope-aware authz primitives) |

### Фаза 3 — Access-core

| Модуль | Статус |
|---|---|
| [passes](./passes-spec.md) | Draft (образец формата) |
| [vehicles](./vehicles-spec.md) | Draft |
| [access-topology](./access-topology-spec.md) | Draft (DH-06 zones/points runtime topology) |
| [access-policies](./access-policies-spec.md) | Draft (DH-13/DH-14 policy CRUD + deterministic evaluation) |
| [security-workspace](./security-workspace-spec.md) | Draft (DH-15 workspace API + DH-16 manual decision baseline) |
| [access-requests](./access-requests-spec.md) | Draft |
| [visit-logs](./visit-logs-spec.md) | Draft |
| [access-incidents](./access-incidents-spec.md) | Draft (covers и `access_overrides`) |
| [qr-verification](./qr-verification-spec.md) | Draft (flow-spec: scan → verdict → log) |

### Фаза 4 — Frontend access-core

| Модуль | Статус |
|---|---|
| [frontend-phase4](./frontend-phase4-spec.md) | Draft (консолидированный план + acceptance) |

### Фаза 5 — Content + Notifications

| Модуль | Статус |
|---|---|
| [notifications-outbox](./notifications-outbox-spec.md) | Draft (инфра; пишется первой, её используют остальные модули Phase 5) |
| [notification-log-v2](./notification-log-v2-spec.md) | Draft (аудит-лог отправок; consumer outbox — см. §5 outbox) |
| [documents-v2](./documents-v2-spec.md) | Draft (body_md + категории + `document_versions`) |
| [packages-v2](./packages-v2-spec.md) | Draft (state machine + SLA-напоминания + fan-out через outbox) |
| [announcements-v2](./announcements-v2-spec.md) | Draft (audience-targeting + fan-out через outbox) |

### Фаза 6 — Legacy content migration

| Модуль | Статус |
|---|---|
| [service-requests](./service-requests-spec.md) | Draft (DH-22 categories + territory/emergency bridge; DH-23 resident-visible attachments/updates; DH-24 assignment/SLA/escalation on `/api/v1/requests`) |
| [staff-workspace](./staff-workspace-spec.md) | Draft (DH-25 unified staff inbox, overdue queue, request detail, resident quick view and internal comments API) |
| [technician-workspace](./technician-workspace-spec.md) | Draft (DH-27 technician queue, start/wait/resolve transitions, resolution output and KPI events API) |
| [technician-workspace-ui](./technician-workspace-ui-spec.md) | Draft (DH-28 technician execution UI over the technician workspace API) |
| [contractor-workspace](./contractor-workspace-spec.md) | Draft (DH-29 contractor assignment, restricted queue/detail and completion API) |
| [contractor-portal-ui](./contractor-portal-ui-spec.md) | Draft (DH-30 restricted external contractor portal over the contractor workspace API) |
| [notification-templates-v2](./notification-templates-v2-spec.md) | Draft (централизованное хранилище текстов уведомлений + mustache-lite rendering; P3 в Phase 6) |
| [legacy-utilities-freeze](./legacy-utilities-freeze-spec.md) | Draft (platform-level freeze-gate для meters/billing/bookings/chat до пост-релиза; P4 в Phase 6) |

### Фаза 7 — Go-live (первый production tenant)

| Документ | Статус |
|---|---|
| [go-live-zamoskv-runbook](./go-live-zamoskv-runbook.md) | Draft (preflight T-7, deploy T-1, seed УК, smoke-test, DNS cutover, rollback; P5a) |
| [resident-offboarding-report](./resident-offboarding-report-spec.md) | Draft (DH-55 resident offboarding report evidence over lifecycle cascades and vehicle review queue) |
| [resident-ownership-transfer](./resident-ownership-transfer-spec.md) | Draft (DH-55 ownership-transfer workflow and notification preference cascade) |
| [privacy-compliance-controls](./privacy-compliance-controls-spec.md) | Draft (DH-56 DSAR workflow, retention/localization/ИСПДн evidence and no-biometrics release guard) |
| [emergency-dispatch-readiness](./emergency-dispatch-readiness-spec.md) | Draft (DH-57 emergency dispatch readiness UI, on-call roster evidence, notification evidence and drill records) |
| [gis-oss-readiness](./gis-oss-readiness-spec.md) | Draft (DH-58 GIS ZhKH / OSS readiness export packages; not certified filing or legally significant e-voting) |
| [skud-provider-failure-dashboard](./skud-provider-failure-dashboard-spec.md) | Draft (DH-59 provider failure dashboard and field rollout evidence over SKUD events/devices/manual control) |
| [sensitive-actions-review-report](./sensitive-actions-review-report-spec.md) | Draft (DH-60 sensitive action review report UI and escalation notification fanout) |
| [pilot-operations-training-pack](./pilot-operations-training-pack-spec.md) | Draft (DH-61 first-week support, guard/checkpoint training, emergency drill, offboarding and PDn/DSAR support evidence) |

**Фаза 5 не покрытая спеками (rename, делается миграцией без отдельного spec-файла):**
- `property_audit_log` — rename из legacy `audit_log` + `actor_type`/`entity_type`/`entity_id`. Миграция в `backend/src/v1/migrations/` при старте Phase 5, отдельный spec-файл не нужен.

## Спеки для следующих фаз (TODO)

Пишутся по мере подхода к соответствующей фазе. Создаются только для сущностей, которые мы реально строим в v1 — не пишем спеки «на будущее».

**Пост-релиз (не пишем сейчас):**
- `meters-module-spec.md`, `billing-module-spec.md`, `bookings-module-spec.md`, `chat-module-spec.md` — после стабилизации access-core

## Правила

1. Спека пишется **до** PR с кодом. PR без обновлённой спеки — не мержится.
2. Если спека меняется в ходе реализации — обновляем spec-файл в том же PR.
3. Acceptance criteria из спеки = чек-лист для ревью.
4. Open questions (§7 шаблона) закрываются **в самой спеке** резолюцией, не в комментариях PR.
