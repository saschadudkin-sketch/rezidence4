# DomHub — ERP / 1C Integration Specification

Дата: 2026-04-21  
Статус: рабочая ERP/1C integration specification  
Назначение: определить, как DomHub должен интегрироваться с ЖКХ/ERP/1C-контуром клиента.

---

## 1. Цель документа

DomHub не должен быть бухгалтерской системой или master ERP.  
Но он должен уметь безопасно обмениваться данными с внешними системами УК/ЖКХ.

Документ определяет:
- какие сценарии ERP/1C интеграции действительно нужны;
- какие данные импортируются/экспортируются;
- что является source of truth;
- как не разрушить tenant isolation и продуктовую модель.

---

## 2. Базовый принцип

ERP/1C integrations для DomHub — это **операционные интеграции**, а не ядро продукта.

Поэтому:
- core product не должен зависеть от ERP для своей базовой работы;
- интеграции должны усиливать onboarding, reporting и data sync;
- отсутствие ERP integration не должно ломать access core.

---

## 3. Основные сценарии интеграции

### 3.1 Импорт структуры объекта

Из внешней системы могут импортироваться:
- объекты;
- корпуса;
- подъезды;
- квартиры / дома / секции;
- машиноместа при наличии.

### 3.2 Импорт пользователей

Могут импортироваться:
- residents;
- staff;
- account linking identifiers;
- базовые контактные данные.

### 3.3 Экспорт операционных данных

Во внешнюю систему можно отдавать:
- access reports;
- incident reports;
- service request reports;
- staff/contractor operational summaries;
- vehicle/visit reports.

### 3.4 Биллинг / ЖКХ-контур

На более зрелом этапе возможны:
- billing record sync;
- resident/account status sync;
- payment-status driven workflows.

Но это уже не ядро access-MVP.

---

## 4. Source of truth rules

### 4.1 ERP/1C is source of truth for

В типовом сценарии внешняя система может быть source of truth для:
- финансовых справочников;
- части resident registry;
- billing/account metadata;
- formal property structure if client insists.

### 4.2 DomHub is source of truth for

DomHub должен оставаться source of truth для:
- access requests;
- approvals;
- passes;
- visit logs;
- incidents;
- access policies;
- security operations;
- resident/staff actions inside DomHub.

### 4.3 Conflict rule

Если внешняя система и DomHub дают конфликтующие данные:
- conflict must be visible;
- DomHub should not silently overwrite operational truth;
- reconciliation must be explicit.

---

## 5. Integration modes

### 5.1 Import-only

Подходит для старта.

Что делаем:
- загружаем справочники из ERP/1C;
- DomHub использует их для operational model;
- назад данные не пушатся автоматически.

Это рекомендуемый first implementation mode.

### 5.2 Export-only

DomHub выгружает отчёты/события во внешнюю систему.

### 5.3 Bi-directional sync

Более сложный режим.

Допускается только когда:
- source-of-truth boundaries clearly defined;
- reconciliation logic formalized;
- idempotency and conflict handling implemented.

---

## 6. Recommended first-scope data exchange

### Import

Первой волной стоит поддержать:
- units/property structure
- resident registry
- staff registry
- contractor/company registry if client has it

### Export

Первой волной стоит поддержать:
- access events summary
- incident summary
- request summary
- CSV export and webhook-compatible exports

---

## 7. Object mapping model

Нужно формализовать mapping:
- `ERP property` -> `DomHub property`
- `ERP building/section` -> `DomHub building/entrance`
- `ERP unit/account` -> `DomHub unit`
- `ERP person/account holder` -> `DomHub resident`

### Mapping rules

- mapping must be explicit;
- external IDs should be stored;
- duplicates must be detectable;
- import should not silently create broken hierarchy.

---

## 8. Resident mapping rules

При импорте residents must support:
- external identifier
- full name
- phone/email if available
- unit binding
- resident type
- active/inactive flag

### Caution

Importing resident data from ERP must not automatically grant access rights unless product rules explicitly define it.

---

## 9. Billing/finance caution

DomHub should not tightly bind access to billing logic in early stages.

Это значит:
- не блокировать базовый доступ автоматически только потому, что есть billing integration, если бизнес-правила клиента это не утвердили;
- любые access restrictions from finance side must be explicit and policy-based.

---

## 10. Transport formats

На старте должны поддерживаться:
- CSV
- REST API
- webhook-based export where needed

Опционально позже:
- message-bus style integration
- scheduled batch sync

---

## 11. Error handling and observability

ERP/1C integrations must have:
- import status
- row-level validation errors where applicable
- sync logs
- retry behavior for transient failures
- reconciliation visibility for mismatched records

---

## 12. Security and compliance rules

Must enforce:
- tenant-scoped configs
- controlled credential storage
- audit of integration config changes
- minimization of transferred PII
- explicit documentation of what is imported/exported

---

## 13. Testing requirements

Must test:
- import validation
- external ID mapping
- duplicate handling
- conflict handling
- export payload correctness
- tenant isolation in import/export jobs

---

## 14. Recommended rollout

### MVP

- no deep ERP dependency
- CSV import/export only

### Strong v2

- basic ERP/1C import/export adapters
- resident/unit/staff sync
- reporting export

### V3

- richer bi-directional sync
- billing-aware workflows where needed
- mature reconciliation tooling

---

## 15. Related documents

This document depends on:
- `domhub-integration-architecture-spec.md`
- `domhub-access-data-model-spec.md`
- `domhub-packaging-and-feature-gating-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`
