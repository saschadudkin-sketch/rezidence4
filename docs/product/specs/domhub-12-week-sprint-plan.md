# DomHub — 12-недельный sprint plan

Дата: 2026-04-21  
Статус: рабочий delivery-plan  
Основа:
- `docs/product/specs/domhub-final-product-plan.md`
- `docs/product/specs/domhub-backlog-epics.md`
- `docs/product/specs/domhub-technical-streams-plan.md`

---

## 1. Назначение документа

Документ разбивает разработку DomHub на 12 недель и 6 двухнедельных спринтов.

Цель плана:
- дать команде реалистичную последовательность разработки;
- не распылить ресурсы на вторичные модули;
- довести продукт до сильного `v2 Core` и затем до `Operations+ / Portfolio-ready` состояния.

---

## 2. Рабочие допущения

План рассчитан на команду, которая может параллельно вести backend, frontend и продуктовую сборку.

Базовые допущения:
- есть 1 продуктовый владелец или lead;
- есть 1 дизайнер или дизайн-функция;
- есть 2 backend-разработчика;
- есть 2 frontend-разработчика;
- есть shared QA/engineering validation;
- есть возможность писать документацию в ходе спринтов, а не в самом конце.

Если команда меньше, нужно резать scope спринтов, а не пытаться сохранить весь объём.

---

## 3. Глобальные правила исполнения

### 3.1 Что входит в каждый спринт

Каждый спринт должен включать:
- проектирование и уточнение scope;
- реализацию backend;
- реализацию frontend;
- тесты критичных сценариев;
- документацию по новым функциям;
- demo и review по итогам спринта.

### 3.2 Что нельзя откладывать

Нельзя откладывать до конца:
- permission model;
- tenant isolation;
- audit logging;
- onboarding process;
- legal/compliance baseline;
- Russian production readiness baseline;
- migration discipline;
- OpenAPI updates.

### 3.3 Release gates

План опирается на 3 контрольные точки:
- `Gate 1: v2 Core`
- `Gate 2: v2 Operations+`
- `Gate 3: Portfolio-ready`

---

## 4. Sprint 1 — Platform Foundation

**Недели:** 1-2  
**Цель:** собрать multi-tenant платформенный фундамент и зафиксировать доменную модель.

### Product outcomes

- платформа умеет оперировать несколькими объектами;
- есть platform admin базового уровня;
- заложена объектная структура и база ролевой модели;
- `property_type` задаёт labels and onboarding mode для ЖК, club house and cottage community;
- tenant isolation формализован и проверяем.

### Scope

- platform DB и property registry;
- platform admin auth;
- create / enable / disable property;
- property settings baseline;
- `management_company`, `property`, `building`, `entrance`, `unit` domain model;
- property-type-aware labels and address formatting baseline;
- resident/unit membership lifecycle baseline;
- sensitive personal-data category baseline;
- roles and scope baseline;
- feature flags baseline;
- platform audit log baseline.

### Deliverables

- migrations для platform-layer;
- backend services для property lifecycle;
- базовый platform admin UI;
- property list / property detail / status view;
- базовая матрица ролей и scope;
- baseline resident lifecycle/offboarding decisions;
- baseline ПДн classification and no-biometrics-by-default decision;
- обновлённая продуктовая и техническая документация.

### Risks

- переусложнение tenant-model на старте;
- отсутствие чёткого решения по `management_company`;
- размытая permission model.

### Exit criteria

- объект создаётся без изменения кода;
- объект может быть создан как `residential_complex`, `club_house` или `cottage_community`;
- resident can be linked as owner/resident/tenant/representative without apartment-only assumptions;
- property context разрешается стабильно;
- данные объектов не пересекаются;
- platform admin видит объекты и может управлять их статусом.

---

## 5. Sprint 2 — Resident Access + Requests Core

**Недели:** 3-4  
**Цель:** запустить 2 главных пользовательских контура: доступ и заявки.

### Product outcomes

- resident может оформить пропуск и создать заявку;
- security может отработать пропуск;
- staff может видеть и разбирать заявки.

### Scope

- resident profile baseline;
- access zones / points baseline for КПП, gates, barriers, doors and service entries;
- pass creation;
- QR pass generation;
- vehicle access baseline;
- public pass page;
- scan/admit/deny flow with selected access point;
- plate lookup baseline;
- visit logs;
- request creation;
- request categories baseline;
- emergency categories baseline;
- request detail;
- request history;
- resident-facing status view.

### Deliverables

- backend APIs для passes, visit logs, requests;
- backend APIs for access points/zones;
- resident UI для создания пропуска и заявки;
- security flow UI for QR, plate baseline, access point selection and entry/exit mode;
- базовая карточка заявки;
- emergency request creation path for permitted categories;
- критичные интеграционные тесты;
- обновление OpenAPI.

### Risks

- недоопределённый request domain;
- слабый UX security flow;
- дублирование логики между resident и staff слоями.

### Exit criteria

- resident может пройти end-to-end сценарий по пропуску;
- security может проверить и завершить QR-flow;
- security может проверить baseline vehicle access по номеру на конкретном КПП/access point;
- resident может создать заявку и видеть её статус;
- emergency заявка отличается от обычной по priority/category;
- staff видит заявки в общей очереди.

---

## 6. Sprint 3 — Assignment, SLA, Staff Workspace

**Недели:** 5-6  
**Цель:** превратить заявку в управляемый операционный процесс.

### Product outcomes

- staff работает в единой очереди;
- заявки назначаются исполнителям;
- SLA считается автоматически;
- property admin видит просрочки и нагрузку.

### Scope

- assignment model;
- SLA config;
- territory/service request categories for cottage communities;
- emergency first-response SLA and escalation rules;
- overdue logic;
- request states enrichment;
- internal comments;
- staff inbox;
- filters by status, type, assignee, overdue;
- request quick actions;
- property admin console baseline;
- packages baseline.

### Deliverables

- backend rules for assignment and SLA;
- request model supports unit/home, access zone, access point and common-territory targets;
- emergency request model supports distinct priority/SLA/escalation profile;
- queue/inbox UI;
- request action controls;
- property admin controls for SLA visibility;
- package registration and pickup baseline;
- critical test coverage for core ops flows.

### Risks

- слишком сложная статусная модель;
- staff workspace останется “списком”, а не рабочим инструментом;
- SLA будет считаться неочевидно.

### Exit criteria

- staff может назначить, взять в работу и обработать заявку;
- cottage-community заявка не требует apartment-only fields;
- просрочка считается автоматически;
- emergency queue is visible separately from ordinary backlog;
- property admin видит queue и critical issues;
- package flow работает базово.

### Gate 1: v2 Core

После Sprint 3 должен существовать strong core:
- multi-tenant foundation;
- resident access flow;
- request flow;
- staff workspace baseline;
- property admin baseline.

Если это не достигнуто, нельзя переходить к росту scope.

---

## 7. Sprint 4 — Notifications, Communication, Onboarding

**Недели:** 7-8  
**Цель:** сделать продукт внедряемым и пригодным для живой эксплуатации.

### Product outcomes

- объект может коммуницировать с жителями;
- уведомления доставляются по ключевым каналам;
- новый объект можно подключать по repeatable process.

### Scope

- announcements;
- documents;
- urgent banners;
- push notifications;
- SMS notifications;
- Telegram baseline;
- notification logs;
- notification preferences baseline;
- urgent/emergency notification routing baseline;
- property launch guide implementation support;
- CSV import for units/residents/staff/vehicles;
- cottage-community import for sector/street, house/plot, vehicles and planned checkpoints;
- resident offboarding/import correction rules;
- access topology provisioning checklist after import;
- emergency dispatch and checkpoint degraded-mode setup checklist;
- launch checklist in product operations flow.

### Deliverables

- notification services and delivery logging;
- admin UI for announcements/documents;
- resident UI for communications;
- import tooling baseline;
- onboarding docs refinement;
- runbook updates.
- first-week pilot support playbook update.

### Risks

- каналы уведомлений окажутся нестабильными;
- импорт данных без валидации создаст хаос;
- onboarding останется ручным despite tools.

### Exit criteria

- уведомления идут по минимум двум каналам;
- announcements/documents управляются через UI;
- новый объект можно загрузить импортом без ручных SQL-манипуляций;
- cottage-community onboarding produces homes/vehicles/checkpoints readiness output;
- есть формальный launch flow.
- launch flow covers offboarding, emergency dispatch and КПП degraded-mode setup.

---

## 8. Sprint 5 — Technician + Contractor + Analytics Baseline

**Недели:** 9-10  
**Цель:** довести операционную модель до реального execution layer.

### Product outcomes

- technician ведёт работы внутри платформы;
- contractor работает в ограниченном контуре;
- аналитика показывает не только записи, но и управленческие метрики.

### Scope

- role `technician`;
- role `contractor`;
- contractor_company / contractor_user baseline;
- technician queue;
- statuses `in_progress`, `waiting_parts`, `waiting_contractor`, `resolved`;
- resolution notes and result photos;
- contractor access limits;
- contractor/service access policies for zones, points and service windows;
- sensitive-action audit for admin/contractor/security changes;
- request KPI analytics;
- SLA analytics;
- notification health analytics;
- staff performance baseline.

### Deliverables

- enriched request workflow;
- contractor access model;
- analytics event baseline;
- object-level dashboards baseline;
- KPI endpoints;
- tests for technician/contractor visibility and flow.

### Risks

- contractor model будет слишком сложным для первой версии;
- аналитика окажется вторичной и неполной;
- команды начнут добавлять вторичные модули раньше времени.

### Exit criteria

- technician может завершить work cycle внутри платформы;
- contractor видит только свои задачи;
- contractor/service access can be limited to point/zone/time window;
- property admin видит SLA и performance baseline;
- property admin can review sensitive access/admin actions;
- ключевые KPI доступны на объекте.

### Gate 2: v2 Operations+

После Sprint 5 DomHub должен быть не просто “системой заявок”, а platform for daily operations:
- execution layer существует;
- contractor model существует;
- analytics baseline существует;
- onboarding repeatable.

---

## 9. Sprint 6 — Management Company + Hardening + Release Readiness

**Недели:** 11-12  
**Цель:** подготовить платформу к работе с УК и к более зрелым клиентам.

### Product outcomes

- УК видит несколько объектов;
- есть портфельный контроль;
- legal/compliance baseline доведён до publishable состояния;
- core продукт стабилизирован перед выходом.

### Scope

- management_company_admin role;
- company-to-properties mapping;
- portfolio dashboard baseline;
- cross-property KPI view;
- cross-property SLA/backlog overview;
- legal docs review pass;
- compliance policy review pass;
- data localization and ИСПДн readiness memo;
- consent/version history and data subject request procedure;
- GIS ЖКХ / ОСС export/readiness boundary;
- hardware integration map for SKUD/barriers/intercoms/LPR/cameras;
- no-biometrics-by-default release note;
- КПП degraded-mode procedure: cached lookup, manual admit/deny, later reconciliation;
- emergency dispatch runbook;
- bug fixing and hardening;
- release checklist and support handoff;
- final v2 packaging.

### Deliverables

- management company UI baseline;
- portfolio analytics endpoints;
- finalised legal/compliance docs for first release set;
- Russia production readiness checklist;
- release notes;
- support and rollout handoff package.

### Risks

- попытка впихнуть сюда integrations and growth modules;
- слабое качество stabilization window;
- недоделанный УК-слой с fragile access model.

### Exit criteria

- management company admin видит свой портфель;
- есть cross-property view без утечки данных;
- legal/compliance baseline готов;
- ПДн, resident lifecycle, emergency/degraded-mode and sensitive-action review baselines are documented;
- КПП имеет documented fallback на краткий сбой связи;
- есть release-ready package для внедрения.

### Gate 3: Portfolio-ready

После Sprint 6 продукт должен быть готов:
- для работы объекта;
- для работы technician/contractor;
- для УК с несколькими объектами;
- для controlled rollout первым клиентам.

---

## 10. Что не включать в эти 12 недель

Следующие модули выносятся за пределы базового 12-недельного плана:
- meter readings;
- OCR;
- billing records;
- online payments;
- booking;
- legally significant OSS voting;
- biometric identity matching;
- full native VMS;
- advanced webhooks;
- advanced automation;
- wide white-label;
- AI-assist features.

Причина: они увеличивают scope, но не усиливают core так же сильно, как operations/platform maturity.

---

## 11. Результат по окончании 12 недель

К концу плана DomHub должен иметь:
- multi-tenant platform foundation;
- property and company model;
- resident access and request flows;
- staff workspace;
- technician and contractor execution layer;
- property admin console;
- management company baseline;
- notifications and communication layer;
- onboarding tooling;
- analytics baseline;
- legal/compliance baseline.
- resident lifecycle/offboarding baseline;
- emergency dispatch baseline;
- sensitive-action audit baseline;
- GIS ЖКХ / ОСС readiness boundary;
- hardware integration map.

Это и есть целевой **release-ready v2+**.

---

## 12. Что делать после 12-й недели

После этого плана следующая волна должна идти так:

### Wave 2

- integrations expansion;
- hardware adapter pilots;
- GIS ЖКХ / ОСС export maturity;
- import/export maturity;
- contractor ecosystem depth;
- advanced portfolio analytics;
- support automation.

### Wave 3

- meter readings;
- OCR;
- billing and payments;
- booking;
- automation rules;
- advanced white-label;
- AI triage / summaries.

---

## 13. Итог

Главный смысл этого плана:

- сначала собрать платформу;
- потом сделать реально работающий operational core;
- затем довести execution, analytics и УК-слой;
- и только потом расширять продукт вторичными модулями.

Если команда начинает раньше времени строить growth-модули, она почти гарантированно ослабит основной продукт.

