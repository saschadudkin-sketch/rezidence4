# DomHub — Техническое ТЗ по потокам разработки

Дата: 2026-04-21  
Статус: рабочее stream-based ТЗ  
Основа: [domhub-final-product-plan.md](D:/rezidence4/.claude/worktrees/vigorous-cray-98c989/docs/product/specs/domhub-final-product-plan.md)

---

## 1. Назначение документа

Документ разбивает разработку DomHub по потокам:
- backend;
- frontend;
- data/analytics;
- integrations;
- legal/compliance;
- operations/onboarding.

Цель — дать каждой функции команды понятный scope ответственности и deliverables.

---

## 2. Backend Stream

### 2.1 Цель

Построить надёжное доменное ядро платформы: multi-tenant, roles/scope, workflows, APIs, audit, notifications.

### 2.2 Обязательный scope

#### Platform Core

- platform DB;
- property registry;
- management_company entity;
- contractor_company entity;
- property settings;
- feature flags;
- platform admin auth;
- property resolution middleware;
- strict tenant isolation.

#### Domain Model

- property structure;
- resident/staff/contractor models;
- request domain;
- pass domain;
- visit logs;
- announcements/documents;
- packages;
- notifications;
- audit events.

#### Workflow Layer

- request statuses and transitions;
- assignment;
- SLA calculations;
- escalation jobs;
- package reminders;
- pass validation and scan flow;
- role-aware visibility rules.

#### Security Layer

- JWT/session model;
- refresh/token revocation;
- access guards;
- rate limiting;
- audit logging;
- consent persistence.

#### API Layer

- stable `/api/v1/*`;
- platform APIs;
- property admin APIs;
- resident/staff APIs;
- analytics APIs;
- import/export endpoints.

### 2.3 Backend deliverables

- схема БД по основным сущностям;
- migrations;
- service layer;
- validation layer;
- permission enforcement;
- OpenAPI updates;
- background jobs;
- tests: unit, integration, contract.

### 2.4 Backend Definition of Done

- tenant isolation проверяется тестами;
- permission checks централизованы;
- API контракты задокументированы;
- audit событий достаточно для разборов и аналитики;
- базовые workflows покрыты интеграционными тестами.

---

## 3. Frontend Stream

### 3.1 Цель

Построить три согласованных интерфейса:
- resident experience;
- object operations workspace;
- portfolio/admin layer.

### 3.2 Обязательный scope

#### Resident UI

- login/session restore;
- home/dashboard;
- pass creation;
- request creation and tracking;
- notifications;
- announcements/documents;
- packages visibility;
- profile/settings/consent.

#### Staff Workspace

- queue/inbox;
- request detail;
- assignment controls;
- status transitions;
- internal notes;
- package workflow;
- resident quick panel;
- pass/visit actions;
- mobile-friendly views for operations staff.

#### Property Admin UI

- staff management;
- role assignment;
- property settings;
- feature flags;
- content publishing;
- SLA visibility;
- analytics;
- audit view.

#### Management Company UI

- portfolio dashboard;
- property comparisons;
- SLA and backlog overview;
- portfolio filters;
- escalations overview.

#### Platform Admin UI

- platform login;
- properties list;
- property detail and status;
- enable/disable;
- platform audit.

### 3.3 UI/UX требования

- единая design system layer;
- accessibility baseline;
- responsive layouts;
- clear error and empty states;
- predictable state transitions;
- differentiated UX for resident vs staff vs admin;
- reduced-motion compliant animations.

### 3.4 Frontend deliverables

- screen map;
- component map;
- route map;
- state architecture;
- API adapters;
- visual states;
- tests for critical journeys.

### 3.5 Frontend Definition of Done

- критические flows проходят без ручных обходов;
- resident UX остаётся простым;
- staff UX поддерживает ежедневную работу;
- основные экраны адаптированы под desktop/mobile contexts.

---

## 4. Data & Analytics Stream

### 4.1 Цель

Сделать аналитику встроенной частью платформы, а не набором случайных отчётов.

### 4.2 Обязательный scope

- event taxonomy;
- KPI definitions;
- analytics source-of-truth model;
- aggregation strategy;
- object-level analytics;
- portfolio-level analytics;
- CSV export;
- notification health reporting;
- staff performance reporting;
- contractor performance reporting.

### 4.3 Ключевые KPI

- requests created;
- requests completed;
- first response time;
- resolution time;
- SLA compliance;
- backlog size;
- overdue share;
- pass/visit volume;
- resident activation;
- staff active usage;
- notification delivery success.

### 4.4 Deliverables

- analytics event dictionary;
- metric definitions;
- reporting API contracts;
- dashboard specs;
- export specs;
- retention strategy for analytical data.

### 4.5 Definition of Done

- у каждой KPI есть формальная формула;
- данные считаются воспроизводимо;
- dashboard и export используют одну и ту же модель данных;
- кросс-объектная аналитика не раскрывает лишние ПДн.

---

## 5. Integrations Stream

### 5.1 Цель

Встроить DomHub в реальную инфраструктуру клиентов.

### 5.2 Scope

- import/export CSV;
- webhook engine baseline;
- integration settings per property;
- delivery/retry model;
- integration logs;
- notification provider integrations;
- access system integrations;
- SKUD, barrier/gate, intercom, LPR and camera/video-evidence integration map;
- billing/ERP/1C integration adapters.
- GIS ЖКХ / ОСС export/readiness boundary.

### 5.3 Deliverables

- integration registry;
- per-provider config model;
- secrets management rules;
- retry and dead-letter strategy;
- integration troubleshooting docs.

### 5.4 Definition of Done

- интеграции конфигурируются на уровне объекта;
- ошибки интеграций видимы и отлаживаемы;
- внешние адаптеры не ломают core workflows.

---

## 6. Legal & Compliance Stream

### 6.1 Цель

Сделать продукт юридически и организационно пригодным для реального рынка РФ.

### 6.2 Scope

#### Public Docs

- privacy policy;
- personal data processing policy;
- terms of use;
- consent to PD;
- consent to notifications.
- consent/version history model.

#### B2B Docs

- master service agreement;
- DPA;
- SLA;
- security overview;
- backup/recovery summary.

#### Internal Compliance

- access control policy;
- retention/deletion standard;
- incident response policy;
- contractor access policy;
- controller/processor model.
- personal-data category registry;
- data localization and ИСПДн readiness assumptions;
- biometric exclusion / feature-gating policy;
- data subject request procedure.

### 6.3 Внутренние задачи

- определить модель оператора/обработчика;
- определить состав ПДн;
- определить сроки хранения;
- определить masking/default visibility для чувствительных полей;
- описать data localization assumptions;
- описать процедуры удаления;
- описать resident offboarding and access revocation procedure;
- описать no-biometrics-by-default boundary;
- описать инцидентный процесс.

### 6.4 Definition of Done

- пакет документов существует и связан между собой;
- продуктовая модель ролей не противоречит access policy;
- сценарии удаления/инцидентов/доступов формально описаны.

---

## 7. Operations & Onboarding Stream

### 7.1 Цель

Сделать внедрение и поддержку repeatable.

### 7.2 Scope

- property launch guide;
- launch checklist;
- import instructions;
- support process;
- runbooks;
- emergency dispatch runbook;
- КПП degraded-mode runbook;
- first-week pilot support playbook;
- resident lifecycle/offboarding guide;
- property admin guide;
- management company admin guide;
- security guide;
- concierge guide;
- technician guide;
- contractor guide.

### 7.3 Deliverables

- onboarding workflow;
- support ownership map;
- escalation map;
- first-week launch procedure;
- incident runbooks.
- checkpoint training procedure.

### 7.4 Definition of Done

- новый объект можно запускать по инструкции;
- роли staff и support понятны;
- есть формальный порядок запуска, поддержки и эскалаций.

---

## 8. Product & Delivery Stream

### 8.1 Цель

Держать реализацию сфокусированной и не дать продукту расползтись.

### 8.2 Scope

- epic prioritization;
- release gates;
- success metrics;
- acceptance criteria;
- customer feedback loop;
- backlog grooming;
- de-scoping rules for non-core modules.

### 8.3 Definition of Done

- каждая фаза имеет release gate;
- backlog привязан к продуктовой стратегии;
- вторичные модули не обгоняют core.

---

## 9. Рекомендуемый порядок запуска потоков

### Этап 1

- Backend
- Frontend
- Product & Delivery

Цель: собрать platform foundation и core v2.

### Этап 2

- Data & Analytics
- Operations & Onboarding
- Legal & Compliance

Цель: сделать продукт внедряемым и управляемым.

### Этап 3

- Integrations
- Management Company layer
- Growth modules selectively

Цель: масштабировать продукт на более зрелых клиентов.

---

## 10. Межпоточные зависимости

### Backend зависит от

- product scope;
- role model;
- legal decisions on controller/processor;
- analytics event requirements.

### Frontend зависит от

- backend contracts;
- design system;
- role model;
- workflow decisions.

### Data зависит от

- backend event model;
- product KPI definitions.

### Legal зависит от

- реальной архитектуры данных;
- ролей и модели доступа;
- интеграционной модели;
- договорной модели продаж.

### Operations зависит от

- onboarding tooling;
- import capabilities;
- property admin UX;
- support ownership.

---

## 11. Release Gates по потокам

### Gate Core v2

Нужно:
- Backend core completed;
- Frontend core completed;
- Legal baseline drafted;
- Onboarding baseline available.

### Gate Operations+

Нужно:
- technician and contractor workflows;
- analytics baseline;
- support runbooks.

### Gate Portfolio

Нужно:
- management company layer;
- portfolio dashboards;
- cross-property controls.

### Gate Final Product

Нужно:
- integrations baseline;
- compliance maturity;
- repeatable rollout;
- support maturity;
- selective growth modules.

---

## 12. Итог

DomHub должен разрабатываться не как последовательность UI-фич, а как синхронизированная система из нескольких потоков.

Критически важно:
- сначала построить основу и core workflows;
- затем довести продукт до operational maturity;
- после этого масштабировать на УК и интеграции;
- и только затем расширять продукт дополнительными модулями.

