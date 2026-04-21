# DomHub — Backlog по эпикам и задачам

Дата: 2026-04-21  
Статус: рабочий продуктовый backlog  
Основа: [domhub-final-product-plan.md](D:/rezidence4/.claude/worktrees/vigorous-cray-98c989/docs/product/specs/domhub-final-product-plan.md)

---

## 1. Назначение документа

Этот backlog переводит итоговую спецификацию DomHub в рабочую структуру разработки:
- эпики;
- продуктовые цели эпика;
- ключевые задачи;
- зависимости;
- критерии готовности.

---

## 2. Правила приоритизации

### P0

Без этого нельзя выпустить сильное ядро v2.

### P1

Сильно повышает коммерческую ценность и зрелость, но может идти после P0.

### P2

Расширяет продукт после подтверждения core value.

---

## 3. Epic 1 — Multi-Tenant Platform Foundation

**Приоритет:** P0  
**Цель:** превратить продукт из single-property решения в платформу.

### Задачи

- спроектировать platform DB;
- реализовать property registry;
- реализовать platform admin auth;
- реализовать create / enable / disable property;
- ввести property settings и feature flags;
- завершить tenant resolution layer;
- обеспечить property-level isolation;
- реализовать platform audit log;
- реализовать platform health overview.

### Зависимости

- backend tenant architecture;
- platform auth model;
- migration strategy.

### Definition of Done

- новый объект создаётся без изменения кода;
- данные объектов не смешиваются;
- platform admin видит список объектов и их статус;
- объект можно отключить централизованно.

---

## 4. Epic 2 — Property Domain Model

**Приоритет:** P0  
**Цель:** ввести нормальную объектную структуру ЖК.

### Задачи

- добавить сущности `management_company`, `property`, `building`, `entrance`, `unit`;
- определить связи resident/staff/unit/property;
- определить модель contractor_company;
- определить адресную модель объекта;
- определить scope доступа по объекту и зонам;
- подготовить импорт структуры объекта.

### Definition of Done

- объект имеет формализованную структуру;
- resident и staff привязаны к корректному контексту;
- будущие workflows не требуют ad hoc полей для адресации.

---

## 5. Epic 3 — Identity, Roles & Permissions

**Приоритет:** P0  
**Цель:** закрепить ролевую модель и управление доступом.

### Задачи

- утвердить роли `resident`, `security`, `concierge`, `technician`, `contractor`, `property_admin`, `management_company_admin`, `platform_admin`;
- реализовать role + scope model;
- добавить ограничение доступа к чувствительным данным;
- добавить временные доступы для подрядчиков;
- реализовать review/rotation процесса доступов;
- подготовить матрицу прав.

### Definition of Done

- права определяются не только ролью, но и scope;
- contractor не видит лишние данные;
- platform_admin не используется для ежедневной операционки клиента;
- права можно формально проверить по матрице.

---

## 6. Epic 4 — Resident Authentication & Profile

**Приоритет:** P0  
**Цель:** дать жителю устойчивый контур входа и персональный профиль.

### Задачи

- доработать resident auth flow;
- добавить resident profile;
- добавить связь resident с unit/property;
- реализовать consent flow;
- добавить notification preferences;
- реализовать session resilience и secure logout.

### Definition of Done

- resident может безопасно войти и восстановить сессию;
- профиль содержит корректный контекст объекта;
- consent и notification preferences формально поддерживаются.

---

## 7. Epic 5 — Access, Passes & Visit Logs

**Приоритет:** P0  
**Цель:** сделать доступ и пропуска одним из основных продающих сценариев.

### Задачи

- resident pass creation flow;
- guest pass model;
- QR pass generation;
- public pass page;
- scan-pass flow for security;
- admit/deny actions;
- visit log persistence;
- search/filter по посещениям;
- audit событий доступа.

### Definition of Done

- житель может оформить пропуск;
- охрана может его проверить и обработать;
- события прохода видны в журнале;
- статус прохода прозрачен для staff.

---

## 8. Epic 6 — Requests Core

**Приоритет:** P0  
**Цель:** сделать заявки центральным операционным контуром.

### Задачи

- модель заявок и категорий;
- формализация request types;
- request creation for resident and staff;
- базовые статусы;
- request history;
- attachments;
- resident-visible comments;
- request detail API/UI.

### Definition of Done

- resident может создать заявку;
- staff видит полную карточку;
- история заявки прозрачна;
- статусная модель пригодна для дальнейшего SLA и assignment.

---

## 9. Epic 7 — Assignment, SLA & Escalations

**Приоритет:** P0  
**Цель:** превратить заявку из записи в управляемый процесс.

### Задачи

- assignment model;
- SLA config by request type;
- due date and overdue logic;
- escalation rules;
- first response tracking;
- resolution tracking;
- overdue notifications;
- SLA analytics foundation.

### Definition of Done

- заявка может быть назначена исполнителю;
- SLA считается автоматически;
- просрочки фиксируются и подсвечиваются;
- есть событийная база для analytics.

---

## 10. Epic 8 — Staff Workspace Baseline

**Приоритет:** P0  
**Цель:** дать персоналу реальный рабочий интерфейс.

### Задачи

- unified inbox;
- request list with filters;
- overdue queue;
- assignee filters;
- request quick actions;
- resident quick view;
- internal comments baseline;
- package quick access;
- mobile-friendly staff layout.

### Definition of Done

- concierge/property_admin могут вести операционку в одном интерфейсе;
- staff не нуждается в внешних таблицах для базовой работы;
- интерфейс пригоден для ежедневного использования.

---

## 11. Epic 9 — Technician Workflow

**Приоритет:** P1  
**Цель:** ввести полноценный слой исполнения работ.

### Задачи

- role `technician`;
- technician queue;
- statuses `in_progress`, `waiting_parts`, `resolved`;
- resolution notes;
- result photos;
- specialization field;
- workload visibility;
- technician performance metrics.

### Definition of Done

- technician может брать задачу и вести её до завершения;
- property_admin видит исполнение работ;
- данные по эффективности техспециалистов доступны в аналитике.

---

## 12. Epic 10 — Contractor Model

**Приоритет:** P1  
**Цель:** встроить внешних подрядчиков в продукт без утечки контекста.

### Задачи

- contractor_company / contractor_user model;
- contractor assignment;
- temporary access rules;
- limited request view;
- contractor comments and result upload;
- contractor completion flow;
- contractor performance analytics.

### Definition of Done

- подрядчик видит только назначенное;
- доступ ограничен по сроку и scope;
- работы подрядчиков отражаются в общей аналитике объекта.

---

## 13. Epic 11 — Resident Communication

**Приоритет:** P0  
**Цель:** обеспечить формальную коммуникацию объекта с жителями.

### Задачи

- announcements;
- documents;
- urgent banners;
- resident notification center;
- read states;
- attachment support;
- publication controls for admins.

### Definition of Done

- объект может публиковать объявления и документы;
- житель видит критичную информацию внутри платформы;
- content управляется без ручных обходных путей.

---

## 14. Epic 12 — Notifications Infrastructure

**Приоритет:** P0  
**Цель:** доставлять события по нужным каналам.

### Задачи

- push subscriptions;
- SMS integration;
- Telegram integration;
- notification templates baseline;
- delivery logging;
- retry/deactivation rules;
- notification preferences;
- notification health metrics.

### Definition of Done

- критичные события доставляются;
- есть журнал доставки;
- отказы каналов отслеживаются;
- notification health виден администратору.

---

## 15. Epic 13 — Packages Workflow

**Приоритет:** P0  
**Цель:** закрыть один из частых front-desk процессов.

### Задачи

- package registration;
- notify recipient;
- pickup flow;
- pickup history;
- reminder logic;
- staff search/filter.

### Definition of Done

- пакет можно зарегистрировать, уведомить и выдать внутри платформы;
- история выдачи сохраняется.

---

## 16. Epic 14 — Property Admin Console

**Приоритет:** P0  
**Цель:** дать объекту полноценное административное управление.

### Задачи

- staff management;
- role assignment;
- feature toggles per property;
- content management;
- request oversight;
- SLA visibility;
- property settings;
- audit view.

### Definition of Done

- property_admin управляет объектом без участия platform_admin;
- staff, контент и базовые процессы конфигурируются в рамках объекта.

---

## 17. Epic 15 — Management Company Layer

**Приоритет:** P1  
**Цель:** сделать продукт ценным для УК с несколькими объектами.

### Задачи

- management_company entity;
- management_company_admin role;
- company-to-properties mapping;
- portfolio dashboard;
- portfolio SLA view;
- shared templates and policies;
- cross-property incident visibility.

### Definition of Done

- УК видит все свои объекты;
- сравнивает KPI и backlog;
- управляет портфелем без доступа к чужим клиентам.

---

## 18. Epic 16 — Analytics & Management Reporting

**Приоритет:** P0/P1  
**Цель:** дать прозрачность, а не только операционный интерфейс.

### Задачи

- event model;
- request KPI endpoints;
- SLA analytics;
- visit analytics;
- notification delivery analytics;
- technician/contractor analytics;
- resident adoption analytics;
- CSV export.

### Definition of Done

- объект и УК видят ключевые KPI;
- есть экспорт;
- аналитика опирается на формализованные события, а не на ad hoc запросы.

---

## 19. Epic 17 — Onboarding & Data Import

**Приоритет:** P0  
**Цель:** убрать ручной хаос при запуске нового клиента.

### Задачи

- property creation wizard;
- CSV import for units;
- CSV import for residents;
- CSV import for staff;
- contractor import;
- launch checklist;
- onboarding guide integration;
- validation and error reporting for imports.

### Definition of Done

- объект можно запустить по repeatable сценарию;
- импорт не требует ручных SQL-операций;
- команда поддержки может пользоваться формальным процессом.

---

## 20. Epic 18 — Legal & Compliance Baseline

**Приоритет:** P0  
**Цель:** подготовить продукт к реальному B2B использованию.

### Задачи

- public legal docs;
- MSA;
- DPA;
- SLA;
- access control policy;
- retention/deletion policy;
- incident response policy;
- controller/processor model;
- contractor access policy.

### Definition of Done

- пакет документов существует в репозитории;
- роли по ПДн формализованы;
- процессы удаления, инцидентов и доступов описаны.

---

## 21. Epic 19 — Integrations Layer

**Приоритет:** P1  
**Цель:** встроить DomHub в реальные IT-контуры клиентов.

### Задачи

- stable API contracts;
- webhook engine baseline;
- import/export APIs;
- integration settings;
- retry model;
- integration error logs;
- connectors for access/billing systems.

### Definition of Done

- есть формальный integration layer;
- сбои интеграций отслеживаются;
- платформу можно подключать к внешним системам без костылей.

---

## 22. Epic 20 — Growth Modules

**Приоритет:** P2  
**Цель:** расширять продукт после подтверждения core value.

### Подэпики

- meter readings;
- OCR hints;
- billing records;
- payments;
- space booking;
- advanced analytics;
- automation rules;
- white-label.

### Definition of Done

- расширения не ломают core;
- внедряются модульно;
- имеют подтверждённый спрос.

---

## 23. Рекомендуемая последовательность реализации

### Волна 1

- Epic 1
- Epic 2
- Epic 3
- Epic 5
- Epic 6
- Epic 7
- Epic 8
- Epic 11
- Epic 12
- Epic 14
- Epic 17
- Epic 18

### Волна 2

- Epic 9
- Epic 10
- Epic 15
- Epic 16
- Epic 19

### Волна 3

- Epic 20

---

## 24. Release Gates

### Gate v2 Core

Должны быть готовы:
- multi-tenant core;
- property domain model;
- roles and permissions baseline;
- access/pass/visit flows;
- requests + assignment + SLA;
- staff workspace baseline;
- communications;
- notifications;
- onboarding baseline;
- legal baseline.

### Gate v2 Operations+

Должны быть готовы:
- technician workflow;
- contractor model;
- richer analytics;
- operational maturity for object teams.

### Gate v2 Portfolio

Должны быть готовы:
- management company layer;
- portfolio analytics;
- cross-property governance.

### Gate Final Product

Должны быть готовы:
- integrations;
- compliance maturity;
- repeatable rollout;
- growth modules selectively enabled.

