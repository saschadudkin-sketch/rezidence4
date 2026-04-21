# DomHub — Итоговая спецификация и план разработки до конечного продукта

Дата: 2026-04-21  
Статус: рабочий master-plan  
Назначение: единый документ, который описывает, каким должен стать DomHub как конечный продукт, в каком порядке его нужно разрабатывать и по каким критериям принимать каждый этап.

---

## 1. Цель документа

Этот документ фиксирует:
- конечную продуктовую форму DomHub;
- обязательные модули платформы;
- целевую организационную и ролевую модель;
- этапы разработки от текущего состояния до зрелой платформы;
- критерии готовности каждого этапа;
- зависимости между продуктом, архитектурой, безопасностью, юридическим контуром и внедрением.

Документ должен использоваться как основной roadmap-level ориентир для product, engineering, design, operations и legal.

---

## 2. Видение конечного продукта

**DomHub** — multi-tenant платформа для управления жилыми комплексами и портфелями объектов.

Платформа должна объединять:
- доступ и гостевые пропуска;
- заявки и сервисные процессы;
- рабочее пространство персонала;
- работу технических специалистов и подрядчиков;
- коммуникацию с жителями;
- управление несколькими объектами для УК;
- аналитику и контроль качества сервиса;
- интеграции с внешними системами;
- юридически и операционно зрелый контур эксплуатации.

Итоговая формула продукта:

`residential operations platform = access + requests + staff workflow + resident communication + management control + integrations + compliance`

---

## 3. Целевой рынок и позиционирование

### 3.1 Основной рынок

- управляющие компании;
- девелоперы;
- операторы нескольких жилых комплексов;
- premium и business-class ЖК;
- объекты, которым нужен высокий уровень сервиса и контроля.

### 3.2 Позиционирование

DomHub — не просто resident app и не просто back-office для УК.  
Это **операционная платформа для управления жилыми комплексами**, ориентированная на качество сервиса, контроль доступа, управляемые процессы и портфельное управление объектами.

### 3.3 Ключевая ценность

Для объекта:
- меньше ручной операционки;
- меньше потерь в коммуникации;
- выше прозрачность процессов;
- лучше resident experience.

Для УК:
- единый стандарт управления;
- контроль нескольких объектов;
- аналитика и SLA на уровне портфеля;
- управляемая модель staff и подрядчиков.

---

## 4. Конечная модель платформы

### 4.1 Иерархия сущностей

- `platform`
- `management_company`
- `property`
- `building`
- `entrance`
- `unit`

### 4.2 Основные сущности домена

- `resident`
- `staff_user`
- `contractor_company`
- `contractor_user`
- `request`
- `request_comment`
- `pass`
- `qr_pass`
- `visit_log`
- `announcement`
- `document`
- `package`
- `notification`
- `audit_log`
- `integration`
- `property_settings`
- `feature_flag`

### 4.3 Обязательные продуктовые принципы

- логическая изоляция каждого объекта;
- разграничение доступа по роли и scope;
- audit trail для критичных действий;
- mobile-friendly staff UX;
- простая resident-facing часть и глубокая operations-facing часть;
- минимизация доступа к персональным данным;
- возможность масштабирования на сеть объектов без ручного перепроектирования.

---

## 5. Целевая ролевая модель

### 5.1 Базовые роли

- `resident`
- `security`
- `concierge`
- `technician`
- `contractor`
- `property_admin`
- `management_company_admin`
- `platform_admin`

### 5.2 Ролевой смысл

**resident**
- создаёт заявки;
- оформляет пропуска;
- получает уведомления;
- видит документы, объявления, статусы.

**security**
- работает с пропусками и проходами;
- сканирует QR;
- фиксирует admit/deny;
- ведёт журнал посещений.

**concierge**
- принимает обращения;
- маршрутизирует заявки;
- взаимодействует с жителями;
- работает с посылками и сервисными сценариями front desk.

**technician**
- принимает назначенные работы;
- переводит заявки по рабочим статусам;
- оставляет техкомментарии;
- фиксирует результат и материалы исполнения.

**contractor**
- видит только назначенные задачи;
- работает во внешнем ограниченном контуре;
- не имеет доступа к платформенному и административному управлению.

**property_admin**
- управляет одним объектом;
- контролирует staff, подрядчиков, SLA, контент и аналитику объекта.

**management_company_admin**
- управляет несколькими объектами своей УК;
- видит агрегированную аналитику;
- контролирует качество сервиса по портфелю.

**platform_admin**
- управляет всей платформой;
- создаёт и отключает объекты;
- контролирует глобальные настройки, аудит и платформенные процессы.

### 5.3 Модель доступа

Роль сама по себе недостаточна. Доступ должен определяться через:
- роль;
- объект;
- корпус / зону;
- тип заявок;
- специализацию;
- назначение на задачу;
- уровень доступа к ПДн;
- срок действия доступа.

---

## 6. Финальный модульный состав продукта

### 6.1 Core Platform

- multi-tenant foundation;
- реестр объектов;
- модель УК;
- модель подрядчиков;
- roles + permissions + scope;
- аутентификация и сессии;
- feature flags;
- platform audit;
- health/status per property;
- файловое хранилище.

### 6.2 Access & Visits

- гостевые пропуска;
- QR-пропуска;
- публичная карточка пропуска;
- scan/admit/deny flow;
- журнал посещений;
- история проходов;
- инциденты по доступу.

### 6.3 Requests & Service Operations

- заявки;
- категории и типы;
- SLA;
- assignment;
- очереди;
- статусы и история;
- внутренние комментарии;
- resident-visible updates;
- оценка после завершения;
- эскалации.

### 6.4 Staff Workspace

- unified inbox;
- assignment board;
- приоритеты и backlog;
- фильтры;
- быстрые действия;
- карточка жителя;
- карточка заявки;
- staff activity timeline;
- package workflow.

### 6.5 Resident Communication

- объявления;
- документы;
- urgent banners;
- push;
- SMS;
- Telegram;
- центр уведомлений.

### 6.6 Management & Analytics

- KPI по объекту;
- KPI по нескольким объектам;
- SLA compliance;
- backlog;
- response/resolution time;
- staff load;
- contractor performance;
- resident adoption;
- notification health;
- CSV export.

### 6.7 Integrations

- stable API;
- webhooks;
- CSV import/export;
- integrations with access systems;
- integrations with billing/ERP/1C;
- integrations with messaging providers;
- integration logs and retry control.

### 6.8 Onboarding & Rollout

- property creation wizard;
- resident/unit/staff import;
- contractor import;
- SLA setup;
- template setup;
- branding basics;
- launch checklist;
- onboarding runbooks.

### 6.9 Growth Modules

- meter readings;
- OCR hints;
- billing records;
- online payments;
- booking;
- advanced analytics;
- white-label;
- automation rules;
- AI-assisted triage and summaries.

---

## 7. Продуктовые принципы разработки

### 7.1 Что считается core

Core DomHub — это:
- доступ;
- заявки;
- staff workflow;
- resident communication;
- audit;
- multi-property control.

### 7.2 Что нельзя делать раньше времени

Нельзя размывать продукт большим количеством вторичных модулей до того, как доказаны:
- внедрение на новом объекте без ручного хаоса;
- ежедневное использование staff workspace;
- реальная ценность для УК;
- стабильный SLA и управление доступами;
- repeatable onboarding.

### 7.3 Принцип релиза

Каждый этап должен давать:
- работающий кусок ценности;
- ясный критерий принятия;
- понятную ответственность внутри команды;
- измеримые продуктовые метрики.

---

## 8. Фазовый план разработки

Ниже план от текущего продукта до конечной платформы.

### Фаза A. Platform Foundation

**Цель:** создать архитектурную основу для платформы и multi-tenant модели.

**Scope:**
- platform DB;
- property registry;
- platform admin auth;
- enable/disable property;
- property-level settings;
- tenant isolation;
- базовый platform audit;
- design system foundation.

**Результат фазы:**
- DomHub поддерживает несколько объектов как платформу, а не как единичную инсталляцию;
- создан технический и продуктовый фундамент для следующих модулей.

**Критерии выхода:**
- можно создать новый объект без изменения кода;
- объект можно включить/отключить централизованно;
- контекст объекта передаётся через валидную tenant-модель;
- нет пересечения данных между объектами;
- platform admin может видеть список объектов и их состояние.

### Фаза B. Operational Core v2

**Цель:** выпустить минимально сильный коммерческий продукт для первых клиентов.

**Scope:**
- property structure;
- resident/staff roles;
- guest passes;
- QR passes;
- visit logs;
- requests;
- assignment;
- SLA;
- staff comments;
- announcements;
- documents;
- push/SMS/Telegram notifications;
- basic analytics;
- packages;
- onboarding basics.

**Результат фазы:**
- продукт продаётся как операционная платформа объекта;
- staff работает внутри системы ежедневно;
- resident получает реальную ценность.

**Критерии выхода:**
- житель может оформить пропуск и создать заявку;
- охрана может отработать QR-flow;
- staff может принять и закрыть заявку;
- уведомления приходят по согласованным каналам;
- property_admin может контролировать queue, SLA и контент;
- новый объект можно запустить по формализованной инструкции.

### Фаза C. Staff & Contractor Maturity

**Цель:** сделать DomHub реальным инструментом эксплуатации, а не только интерфейсом обращения.

**Scope:**
- technician role;
- contractor model;
- contractor_company / contractor_user;
- specialization;
- assignment board;
- richer request statuses;
- internal notes;
- resident-visible updates;
- contractor access limits;
- performance metrics by technician and contractor.

**Результат фазы:**
- процессы исполнения заявок полностью живут в платформе;
- подрядчики и техспециалисты контролируются через DomHub;
- у объекта появляется прозрачное operational execution layer.

**Критерии выхода:**
- technician может работать по полноценному workflow;
- contractor имеет ограниченный контур доступа;
- property_admin видит статус исполнения и узкие места;
- есть аналитика по исполнителям.

### Фаза D. Multi-Property Management

**Цель:** превратить DomHub в рабочий инструмент для управляющей компании, а не только для одного объекта.

**Scope:**
- management_company entity;
- management_company_admin role;
- портфельная аналитика;
- cross-property dashboards;
- shared policies and templates;
- multi-property staff governance;
- portfolio SLA view;
- problematic property monitoring.

**Результат фазы:**
- УК получает управленческий кабинет;
- продукт становится значительно сильнее как B2B SaaS.

**Критерии выхода:**
- УК может видеть несколько объектов в одном контуре;
- есть агрегированные KPI;
- можно сравнивать backlog/SLA по объектам;
- роли и процессы управляются без platform-admin вмешательства в ежедневную операционку.

### Фаза E. Integrations & Compliance Maturity

**Цель:** сделать продукт внедряемым в реальные процессы клиентов и безопасным для масштабных продаж.

**Scope:**
- webhook/API layer;
- access system integrations;
- billing/ERP/1C connectors;
- import/export maturity;
- integration logs;
- retry model;
- final legal packet;
- compliance policies;
- retention/deletion procedures;
- incident runbooks;
- access governance.

**Результат фазы:**
- платформа готова к более сложным клиентам;
- снижается friction внедрения;
- повышается доверие со стороны клиентов и юристов.

**Критерии выхода:**
- есть формализованный юрпакет;
- есть политика доступов, инцидентов и удаления данных;
- есть контролируемый integration layer;
- есть экспорт/импорт, пригодный для реальных внедрений.

### Фаза F. Growth Modules

**Цель:** нарастить дополнительные модули после подтверждения ядра.

**Scope:**
- meter readings;
- OCR;
- billing records;
- payments;
- booking;
- advanced notifications;
- advanced analytics;
- automation rules;
- white-label features.

**Результат фазы:**
- DomHub становится широкой экосистемой управления объектом.

**Критерии выхода:**
- growth-модули не ломают core;
- основная эксплуатация уже доказала свою ценность;
- команда и клиенты готовы к расширению scope.

### Фаза G. Final Product State

**Цель:** довести платформу до зрелого конечного состояния.

**Финальный результат:**
- multi-tenant platform;
- portfolio management for UK;
- full operational workspace;
- contractor ecosystem;
- resident digital service;
- integrated ecosystem;
- legal/compliance maturity;
- predictable onboarding and support;
- strong analytics and management tooling.

---

## 9. Рабочие потоки разработки

Разработка должна идти не только по фичам, но и по параллельным направлениям.

### 9.1 Product Stream

- приоритизация scope;
- сценарии пользователей;
- продуктовые KPI;
- спецификация ролей и workflow;
- backlog management.

### 9.2 Backend Stream

- доменная модель;
- tenant isolation;
- role/scope enforcement;
- APIs;
- notifications;
- integrations;
- analytics data model;
- audit logging.

### 9.3 Frontend Stream

- resident app;
- staff workspace;
- УК dashboard;
- platform admin;
- responsive layouts;
- design system;
- state architecture;
- accessibility and error handling.

### 9.4 Data & Analytics Stream

- event model;
- KPI definitions;
- analytics endpoints;
- CSV export;
- management dashboards.

### 9.5 Security & Compliance Stream

- access control;
- retention/deletion;
- incident response;
- audit trail;
- legal docs;
- operator/processor model.

### 9.6 Rollout & Support Stream

- onboarding guides;
- import tooling;
- launch checklist;
- support process;
- operational runbooks.

---

## 10. Обязательные зависимости между этапами

### 10.1 Без чего нельзя выпускать Operational Core

- multi-tenant foundation;
- property structure;
- roles and permissions baseline;
- audit logging baseline;
- notification infrastructure baseline.

### 10.2 Без чего нельзя масштабировать на УК

- полноценный property_admin слой;
- staff workflow;
- аналитика по объекту;
- contractor/technician execution model;
- onboarding repeatability.

### 10.3 Без чего нельзя продавать enterprise-like клиентам

- юрпакет;
- access policy;
- incident policy;
- retention/deletion standard;
- integration governance;
- backup/recovery summary.

---

## 11. Целевые статусы и workflow заявок

### 11.1 Базовые статусы

- `new`
- `triaged`
- `assigned`
- `in_progress`
- `waiting_resident`
- `waiting_parts`
- `waiting_contractor`
- `resolved`
- `completed`
- `cancelled`
- `rejected`

### 11.2 Обязательные поля заявки

- `assigned_to`
- `assigned_by`
- `assigned_at`
- `priority`
- `specialization_required`
- `sla_due_at`
- `first_response_at`
- `started_at`
- `resolved_at`
- `completed_at`
- `status_reason`
- `resolution_note`
- `requires_follow_up`
- `requires_external_contractor`

### 11.3 Принцип UX

Жителю показываются упрощённые статусы:
- Принята
- В работе
- Нужно ваше действие
- Решена
- Завершена
- Отменена
- Отклонена

Staff работает с полной внутренней статусной моделью.

---

## 12. Юридический и операционный контур

До выхода на зрелый продукт должны быть готовы:

### 12.1 Публичные документы

- privacy policy;
- personal data processing policy;
- terms of use;
- consent to personal data processing;
- consent to notifications.

### 12.2 B2B документы

- master service agreement;
- DPA;
- SLA;
- security overview;
- backup and recovery summary.

### 12.3 Compliance документы

- retention and deletion standard;
- access control policy;
- incident response policy;
- contractor access policy;
- controller/processor model.

### 12.4 Operations docs

- property launch guide;
- launch checklist;
- property admin guide;
- management company admin guide;
- security guide;
- concierge guide;
- technician guide;
- contractor guide.

---

## 13. Метрики успеха

### 13.1 Коммерческие

- число активных объектов;
- число активных УК;
- conversion из пилота в платного клиента;
- время запуска нового объекта;
- средний срок внедрения.

### 13.2 Продуктовые

- resident activation rate;
- weekly active staff;
- weekly active property admins;
- доля заявок, созданных и закрытых внутри платформы;
- adoption staff workspace.

### 13.3 Операционные

- median first response time;
- median resolution time;
- SLA compliance rate;
- backlog size;
- overdue share;
- contractor completion quality;
- notification delivery success rate.

### 13.4 Платформенные

- uptime;
- failed integrations rate;
- tenant isolation incidents;
- critical incident count;
- access review completion rate.

---

## 14. Риски

### 14.1 Продуктовые

- распыление на вторичные модули до доказанного core;
- слишком слабый staff workspace;
- отсутствие repeatable onboarding;
- неясное позиционирование между resident app и full operations platform.

### 14.2 Технические

- слабая tenant isolation discipline;
- сложная permission model без формализации scope;
- недооценка analytics/event model;
- технический долг по integrations.

### 14.3 Операционные

- ручное внедрение каждого объекта;
- отсутствие runbooks;
- зависимость от отдельных людей на запуске.

### 14.4 Юридические

- неформализованная модель оператор/обработчик;
- неполный пакет документов;
- неочевидная локализация и цепочка субобработчиков;
- отсутствие формальных политик доступа и удаления данных.

---

## 15. Порядок приоритетов

### P0 — обязательно

- multi-tenant core;
- property structure;
- access/pass/visit flows;
- requests + SLA + assignment;
- notifications;
- staff workspace baseline;
- property_admin;
- onboarding baseline;
- audit trail;
- legal/compliance baseline.

### P1 — сильно желательно

- technician and contractor maturity;
- management_company layer;
- portfolio analytics;
- import/export maturity;
- integration baseline;
- performance analytics by staff and contractors.

### P2 — после подтверждения core value

- meter readings;
- OCR;
- booking;
- payments;
- advanced analytics;
- automation;
- white-label expansion.

---

## 16. Финальная формула roadmap

Разработка DomHub должна идти в такой последовательности:

1. Построить platform foundation.  
2. Выпустить сильное ядро v2 для одного объекта как коммерчески понятный продукт.  
3. Углубить staff, technician и contractor workflow.  
4. Построить полноценный слой для управляющей компании и нескольких объектов.  
5. Довести integrations, compliance и rollout до зрелого состояния.  
6. Только после этого масштабировать продукт growth-модулями.

---

## 17. Итоговое определение конечного продукта

Конечный DomHub — это:

- платформа, а не набор экранов;
- система ежедневной эксплуатации, а не только витрина для жителей;
- инструмент портфельного управления для УК, а не только интерфейс одного объекта;
- контролируемый контур работы staff и подрядчиков;
- продукт, готовый к юридическому, операционному и техническому масштабированию.

Итоговый критерий успеха:

> новый жилой комплекс можно подключить, обучить, запустить и перевести в ежедневную эксплуатацию внутри DomHub без хаотичных ручных процессов и без разработки под каждого клиента с нуля.
