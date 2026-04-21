# DomHub — Deployment and Tenant Operations Specification

Дата: 2026-04-21  
Статус: рабочая deployment/ops specification  
Назначение: определить, как DomHub разворачивается, как создаются и обслуживаются tenants, и как должна работать эксплуатация multi-tenant платформы.

---

## 1. Цель документа

Документ определяет:
- архитектуру развёртывания DomHub;
- обязанности platform layer и property layer;
- порядок создания нового объекта;
- порядок миграций;
- backup/restore стратегию;
- secrets/config модель;
- observability и incident operations;
- release and rollback expectations.

---

## 2. Базовая модель развёртывания

DomHub — это multi-tenant платформа с двумя уровнями хранения:

### Platform layer

Содержит:
- registry DB
- platform-level auth/admin
- management company mappings
- platform audit
- global health metadata

### Property layer

Содержит:
- отдельную БД на объект;
- object-specific operational data;
- access events, requests, incidents, notifications, content;
- local settings and integrations.

### Принцип

Каждый объект должен быть логически изолирован на уровне своей property DB.  
Platform DB не должна хранить operational source-of-truth объекта, кроме routing and governance metadata.

---

## 3. Целевые окружения

Обязательные окружения:
- `local`
- `ci`
- `staging`
- `production`

### 3.1 Local

Для разработки:
- локальный backend/frontend;
- test or local registry DB;
- local property DB fixtures;
- optional local Redis.

### 3.2 CI

Для автоматической проверки:
- ephemeral DBs for tests;
- migrations on clean databases;
- seeded property fixtures;
- no dependence on production-like secrets.

### 3.3 Staging

Для pre-release проверки:
- production-like config shape;
- isolated staging tenants;
- smoke testing;
- integration verification;
- release candidate validation.

### 3.4 Production

Для боевой эксплуатации:
- platform DB;
- multiple property DBs;
- secure secret storage;
- monitoring/alerting;
- backup/restore routines;
- operational runbooks.

---

## 4. Tenant provisioning model

## 4.1 Создание нового property tenant

Provisioning нового объекта должен включать:

1. Создание записи в `platform.properties`
2. Назначение `management_company_id`, если применимо
3. Создание property DB
4. Применение property migrations
5. Инициализацию object-level settings
6. Создание базовых ролей/админов объекта
7. Подготовку import/onboarding состояния
8. Регистрацию health metadata

### 4.2 Provisioning contract

Новый объект считается созданным только если:
- property record существует в platform DB;
- property DB доступна;
- migrations успешно применены;
- tenant resolution работает;
- объект доступен в platform admin UI;
- статус объекта выставлен осознанно (`active`, `maintenance`, etc.).

## 4.3 Property statuses

Поддерживаемые статусы:
- `active`
- `suspended`
- `maintenance`
- `terminated`

### Поведение

- `active` — объект работает штатно
- `suspended` — операции ограничены, tenant routing блокирует нормальную работу
- `maintenance` — временная техническая блокировка
- `terminated` — объект окончательно выведен из эксплуатации

---

## 5. Tenant resolution and runtime behavior

### 5.1 Runtime routing

Каждый входящий request должен:
- определить `property slug` / tenant context;
- получить connection details from platform layer;
- использовать property-scoped DB connection;
- enforce role and scope within property boundary.

### 5.2 Caching

Tenant resolution может кешироваться, но:
- cache must be time-bounded;
- cache invalidation required on property status/config changes;
- stale disabled tenant resolution is unacceptable beyond configured TTL.

### 5.3 Pooling

Property DB connections должны управляться ограниченным pool manager:
- bounded connection pools;
- eviction for inactive tenants;
- no unbounded pool growth.

---

## 6. Migration strategy

## 6.1 Platform migrations

Platform migrations применяются отдельно от property migrations.

Они затрагивают:
- management companies;
- properties registry;
- platform admins;
- platform audit;
- portfolio governance metadata.

## 6.2 Property migrations

Property migrations применяются к каждой property DB.

Они затрагивают:
- structure;
- residents/staff/contractors;
- access domain;
- requests/incidents;
- notifications/content;
- integrations and audit.

## 6.3 Migration rules

- platform and property migrations version independently;
- every migration must be idempotent where possible;
- no destructive migration without explicit rollout plan;
- existing active tenants must be migrated in controlled sequence;
- migration health must be observable.

## 6.4 Rollout strategy

Рекомендуемый порядок:
1. apply platform migrations
2. verify platform health
3. apply property migrations in controlled batches
4. verify tenant health
5. enable new feature flags progressively if needed

---

## 7. Secrets and configuration

## 7.1 Platform-level secrets

- platform DB credentials
- platform JWT secrets
- Redis credentials
- monitoring/alerting credentials

## 7.2 Property-level configuration

На уровне объекта конфигурируются:
- integrations
- messaging providers
- branding-related settings
- feature flags
- access-system provider settings

### Правило

Sensitive secrets should not be stored in plain text in mutable UI payloads without secure handling strategy.

---

## 8. Backup and restore model

## 8.1 Backup scope

Backups required for:
- platform DB
- every property DB
- critical file storage if used
- essential configuration metadata

## 8.2 Backup principles

- scheduled backups
- retention windows
- restricted access
- restore validation drills
- per-tenant restore capability preferred

## 8.3 Restore requirements

Must be able to:
- restore platform metadata
- restore single tenant/property DB
- restore full environment if needed
- understand restore ordering between platform and property layers

## 8.4 Deletion and restore interplay

If tenant data is deleted or anonymized:
- productive deletion rules must be respected;
- backup behavior must be documented;
- restore of deleted PII must follow legal/compliance decisions.

---

## 9. Observability and health

## 9.1 Platform-level health

Must monitor:
- platform DB health
- registry lookup health
- auth health
- Redis health
- notification service health
- global API health

## 9.2 Property-level health

Must monitor:
- tenant DB connectivity
- migration state
- request processing health
- access-event processing health
- integration health
- incident volume anomalies

## 9.3 Health endpoints

Must have:
- platform health endpoint
- property/access health indicators
- integration-specific health where possible

---

## 10. Release management

## 10.1 Release types

- patch release
- minor feature release
- schema-changing release
- incident hotfix

## 10.2 Release rules

- every release must define whether platform migrations are required
- every release must define whether property migrations are required
- schema-changing releases require staging validation
- release notes must include operational impact

## 10.3 Feature flags

Feature flags should be used for:
- progressive enablement
- risky modules
- tenant-specific rollout
- post-migration gating

---

## 11. Rollback strategy

## 11.1 Principle

Rollback must be defined before shipping risky releases.

## 11.2 Acceptable rollback patterns

- code rollback when schema remains compatible
- feature-flag disable
- maintenance mode for affected tenants
- tenant-level isolation while issue is resolved

## 11.3 Dangerous cases

Irreversible schema changes without restore plan are unacceptable.

For schema-changing releases, one of the following must exist:
- backward compatible migration
- reversible migration path
- restore strategy with tested backup

---

## 12. Onboarding operations

## 12.1 Pre-launch checklist

Before tenant activation:
- property created in platform DB
- property DB reachable
- migrations applied
- staff admin assigned
- import templates prepared
- access configuration baseline loaded
- notifications configured
- smoke tests passed

## 12.2 First-week support mode

For new tenants:
- support owner assigned
- launch checklist tracked
- incidents triaged faster than usual
- notification and access flows watched closely

---

## 13. Incident operations

## 13.1 Platform incidents

Examples:
- registry DB unavailable
- tenant resolution failure
- auth/global notification outage

## 13.2 Property incidents

Examples:
- one tenant DB unavailable
- migration failed for one property
- access integration broken on one object
- incident spike on one object

## 13.3 Operational rule

Platform incidents and property incidents must be distinguishable in tooling and runbooks.

---

## 14. Tenant lifecycle

### 14.1 Active tenant

Normal production operation.

### 14.2 Suspended tenant

Temporarily blocked due to business/legal/operational reasons.

### 14.3 Maintenance tenant

Temporarily unavailable due to technical work.

### 14.4 Terminated tenant

No longer active; operational access disabled; data handling follows retention/deletion policy.

---

## 15. Definition of operational readiness

DomHub multi-tenant ops model can be considered mature when:
- new tenant provisioning is repeatable;
- migrations are controlled and observable;
- platform and property health are separately visible;
- backup and restore are documented and tested;
- release impact on tenants is understood before deployment;
- incident ownership is clear;
- rollout and rollback are formalized.

---

## 16. Следующий логичный документ

После этого документа полезно сделать:
- `domhub-integration-architecture-spec.md`

Потому что deployment/tenant ops должны быть согласованы с тем,
как внешние access systems, webhooks и provider adapters живут в multi-tenant среде.

