# DomHub — Video Integration Specification

Дата: 2026-04-21  
Статус: рабочая video integration specification  
Назначение: определить, как видеонаблюдение интегрируется в DomHub как часть access and incident workflows.

---

## 1. Цель документа

Видеонаблюдение в DomHub не является отдельным самостоятельным продуктом.  
Оно должно усиливать:
- access events;
- security workflows;
- incident investigation;
- audit and evidence.

DomHub не должен заменять полноценную VMS.  
Он должен связывать события доступа с video evidence.

---

## 2. Основной принцип

Video integration в DomHub =  
**access event -> camera context -> clip/snapshot link -> incident evidence**

То есть видео используется как:
- подтверждение факта события;
- инструмент разбора спорных случаев;
- контекст для охраны и admin;
- доказательная база по инцидентам.

---

## 3. Основные сценарии

### 3.1 Событие прохода

Когда происходит access event:
- allow
- deny
- manual override
- suspicious attempt

DomHub должен по возможности уметь привязать к событию:
- камеру;
- ссылку на клип;
- ссылку на snapshot;
- внешний event ID.

### 3.2 Инцидент

При access incident security/admin должны видеть:
- связанные события;
- клип/снимок;
- временную шкалу;
- access point;
- actor/person/vehicle context.

### 3.3 Vehicle access

Для въезда транспорта видеослой полезен для:
- подтверждения номера/факта подъезда;
- разбора deny/blacklist cases;
- evidence around barrier events.

---

## 4. Базовая модель данных

Video integration должна опираться на:
- `access_point`
- `visit_log`
- `access_incident`
- `integration`
- `integration_event`

### Дополнительные поля / сущности

Рекомендуется добавить или поддержать:
- `camera_id`
- `camera_group_id`
- `clip_url`
- `snapshot_url`
- `video_provider_event_id`
- `video_timestamp_from`
- `video_timestamp_to`

### Mapping

Каждый `access_point` может иметь:
- 0..N связанных камер

Каждый `access_incident` может иметь:
- 0..N video evidence references

---

## 5. Camera mapping model

### 5.1 Access point to camera

Должен существовать mapping:
- `access_point -> camera(s)`

Примеры:
- шлагбаум КПП 1 -> камера въезда 1
- калитка A -> камера калитки A
- дверь подъезда 2 -> камера входной группы

### 5.2 Camera ownership

Камера должна быть:
- property-scoped;
- provider-scoped;
- связана с integration config.

---

## 6. Минимальный функциональный scope

### MVP

Video integration не является обязательной частью MVP.  
На MVP можно жить без неё.

### Strong v2

Минимальная video integration должна включать:
- возможность привязать access point к camera context;
- возможность хранить `clip_url` / `snapshot_url`;
- возможность показывать ссылку на видео из incident/event view;
- сохранение внешнего provider event ID.

### V3

Более зрелый видеослой:
- automatic clip binding to access events;
- event-driven snapshot fetch;
- incident timeline with video references;
- deeper VMS integration;
- camera health visibility.

---

## 7. Supported interaction patterns

### Pattern A — Link-only

DomHub хранит ссылку на клип/событие во внешней VMS.

Плюсы:
- проще;
- быстрее реализуется;
- не требует глубокого video stack inside DomHub.

Это рекомендуемый стартовый вариант.

### Pattern B — Snapshot support

DomHub additionally хранит ссылку на snapshot/preview.

### Pattern C — Event-driven clip generation

Внешняя система по event или webhook отдаёт clip reference in near real time.

Это более зрелый вариант.

---

## 8. Incident workflow with video

Для `access_incident` UI должен уметь показывать:
- тип инцидента
- доступ/пропуск/авто
- точку доступа
- связанный visit log
- clip link
- snapshot link
- external provider reference

Если clip не доступен:
- это должно быть видно как “video unavailable / not linked”, а не silently missing.

---

## 9. Security and privacy rules

Video integration должна соблюдать:
- property boundary;
- role/scope restrictions;
- least privilege;
- no uncontrolled public access to clips;
- no leaking raw provider credentials.

### Доступ к видео

Роли:
- `security` — scoped access
- `property_admin` — scoped access
- `management_company_admin` — только если business/legal model это допускает
- `resident` — по умолчанию не должен видеть video evidence except explicit designed case

---

## 10. Integration patterns

### Inbound

Внешняя video/VMS система присылает:
- event
- clip link
- snapshot
- timestamps

### Outbound

DomHub может:
- запрашивать clip context for event
- запрашивать evidence on incident drill-down

### Hybrid

Best long-term model:
- inbound event for near-real-time
- outbound fetch for reconciliation or expanded evidence

---

## 11. Failure handling

Если video evidence не удалось получить:
- access event всё равно должен быть записан;
- incident всё равно может быть создан;
- link failure должен логироваться как integration event;
- UI должен явно показывать отсутствие clip binding.

---

## 12. Testing requirements

Must test:
- access point to camera mapping
- incident with video reference
- missing video link behavior
- role-based access to evidence
- tenant isolation for video references
- provider error handling

---

## 13. Recommended first provider direction

Для РФ video integration should first align with:
- Hikvision-class ecosystems
- TRASSIR-linked scenarios
- mixed SKUD + VMS event linking

Но документ intentionally не фиксирует vendor SDK details.  
Это должно решаться через adapter architecture.

---

## 14. Related documents

This document depends on:
- `domhub-integration-architecture-spec.md`
- `domhub-skud-vendor-priority-spec.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`

*** Add File: D:\rezidence4\.claude\worktrees\vigorous-cray-98c989\docs\product\specs\domhub-erp-1c-integration-spec.md
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

