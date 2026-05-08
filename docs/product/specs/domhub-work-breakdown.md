# DomHub — Декомпозиция работ до уровня database / API / UI / tests / docs

Дата: 2026-04-21  
Статус: рабочее WBS-level ТЗ  
Основа:
- `docs/product/specs/domhub-backlog-epics.md`
- `docs/product/specs/domhub-technical-streams-plan.md`

---

## 1. Назначение документа

Документ раскладывает эпики DomHub на инженерные типы работ:
- `database`
- `backend/API`
- `frontend/UI`
- `tests`
- `docs`

Этот документ нужен для:
- оценки объёма;
- планирования спринтов;
- постановки задач разработчикам;
- контроля completeness по каждому эпику.

---

## 2. Epic 1 — Multi-Tenant Platform Foundation

### Database

- таблица `properties`;
- таблица `platform_admins` и platform sessions;
- таблица `platform_audit_log`;
- индексы для property lookup;
- миграции для feature flags и property settings.

### Backend/API

- platform auth endpoints;
- properties list/create/detail/update;
- enable/disable property;
- tenant resolution middleware;
- platform audit service;
- property health service.

### Frontend/UI

- platform login;
- properties table;
- property detail screen;
- enable/disable actions;
- basic platform audit view.

### Tests

- tenant isolation tests;
- property lifecycle integration tests;
- auth tests for platform admin;
- regression tests on property resolution.

### Docs

- architecture update;
- platform API spec;
- admin usage notes;
- migration notes.

---

## 3. Epic 2 — Property Domain Model

### Database

- `management_companies`;
- `buildings`;
- `entrances`;
- `units`;
- `resident_unit_memberships`;
- foreign keys `property -> building -> entrance -> unit`;
- property-type-aware mapping for ЖК, club house, and cottage community address structures;
- resident-to-unit and staff-to-property mapping;
- ownership/tenancy/representative lifecycle fields;
- contractor company tables.

### Backend/API

- CRUD or import endpoints for object structure;
- lookup services for structure navigation;
- validation for address hierarchy;
- property-type-aware display address formatter;
- scope calculation helpers.
- resident membership lifecycle service.

### Frontend/UI

- property structure screens;
- unit assignment UI;
- resident membership and offboarding UI;
- labels for apartment/entrance vs house/plot modes;
- import preview UI or admin upload state;
- staff property context views.

### Tests

- entity relation integrity tests;
- lifecycle cascade tests for passes, vehicles and scopes;
- import validation tests;
- scope resolution tests.

### Docs

- domain model spec;
- residential territory model spec;
- import format spec;
- object setup guide.

---

## 4. Epic 3 — Identity, Roles & Permissions

### Database

- user role fields;
- access scope tables or mapping tables;
- temporary access fields;
- contractor access expiry fields;
- access review tables/fields;
- consent and permission audit fields.

### Backend/API

- role guard middleware;
- scope evaluation services;
- permission matrix enforcement;
- account lifecycle actions;
- access review support endpoints.
- sensitive-action audit emitters.

### Frontend/UI

- role assignment forms;
- scope assignment UI;
- access review screens;
- sensitive-action report states;
- restricted data masking states.

### Tests

- permission unit tests;
- role/scope integration tests;
- negative access tests;
- contractor visibility tests.
- sensitive-action audit tests.

### Docs

- role matrix;
- access-control policy alignment;
- role glossary.

---

## 5. Epic 4 — Resident Authentication & Profile

### Database

- resident profile fields;
- resident membership status fields;
- notification preferences;
- consent timestamps;
- consent version/source fields;
- session-related security data.

### Backend/API

- auth/session endpoints;
- profile endpoint;
- resident offboarding/revocation endpoint;
- consent endpoint;
- preferences update endpoint;
- logout/session revocation flow.

### Frontend/UI

- resident login states;
- profile page;
- consent modal/flow;
- notification settings.
- offboarding/admin correction states.

### Tests

- auth flow tests;
- session restore tests;
- consent flow tests;
- offboarding cascade tests;
- profile permission tests.

### Docs

- resident auth guide;
- consent handling notes;
- API spec updates.

---

## 6. Epic 5 — Access, Passes & Visit Logs

### Database

- `passes` or request-linked pass model;
- `qr_passes`;
- `visit_logs`;
- `access_zones`;
- `access_points`;
- access policy templates/bindings for zone, point, method, schedule and vehicle rules;
- pass token indexes;
- audit fields for admit/deny.

### Backend/API

- create pass endpoint;
- pass detail endpoints;
- public pass endpoint;
- QR validation endpoint;
- zone/point CRUD endpoints;
- policy evaluation service used by QR/plate verification;
- admit/deny endpoints;
- visit log listing/search endpoints.

### Frontend/UI

- resident pass creation flow;
- QR pass card;
- public pass screen;
- security scan/decision screens;
- access point selector for guard/checkpoint;
- entry/exit mode and vehicle-first checkpoint flow for cottage communities;
- visit log views.

### Tests

- token validation tests;
- public pass security tests;
- admit/deny flow integration tests;
- access point selection and visit-log linkage tests;
- policy binding/evaluation tests for zone, point and vehicle access;
- visit log persistence tests.

### Docs

- access flow spec;
- guard usage guide;
- API contract updates.

---

## 7. Epic 6 — Requests Core

### Database

- request tables/fields;
- request category/type tables or enums;
- target fields for unit/home, access zone, access point, and common territory;
- emergency request profile fields;
- attachments relation;
- request history;
- resident-facing vs internal fields.

### Backend/API

- create/read/update request endpoints;
- request detail endpoint;
- comment/history endpoints;
- request filters;
- target validation for unit/home, zone, point, and common territory;
- emergency priority/SLA classification;
- resident and staff visibility rules.

### Frontend/UI

- resident request creation form;
- property-type-aware target picker;
- emergency category and severity picker where permitted;
- resident request history;
- staff request detail;
- attachments UI;
- status display components.

### Tests

- request creation tests;
- cottage-community territory request tests;
- emergency request classification tests;
- visibility tests;
- history tests;
- attachment handling tests.

### Docs

- request domain spec;
- request type glossary;
- API docs.

---

## 8. Epic 7 — Assignment, SLA & Escalations

### Database

- `request_sla_config`;
- emergency SLA config;
- fields `assigned_to`, `assigned_at`, `sla_due_at`, `first_response_at`, `resolved_at`, `completed_at`;
- escalation markers;
- overdue notification markers.

### Backend/API

- assignment endpoints;
- SLA calculation service;
- emergency escalation service;
- overdue jobs;
- escalation rules;
- timeline event generation.

### Frontend/UI

- assignment controls;
- SLA badges;
- emergency queue indicators;
- overdue indicators;
- timeline state changes;
- property admin SLA views.

### Tests

- SLA calculation unit tests;
- emergency escalation tests;
- overdue job tests;
- assignment visibility tests;
- state transition tests.

### Docs

- SLA rules spec;
- operational policy notes;
- admin guide updates.

---

## 9. Epic 8 — Staff Workspace Baseline

### Database

- no major new core tables beyond queue/filter support;
- saved filters or preferences if needed;
- workspace activity tracking if adopted.

### Backend/API

- queue endpoints;
- filter/search endpoints;
- quick action APIs;
- request summary endpoints;
- package summary endpoints.

### Frontend/UI

- unified inbox;
- filter bar;
- queue rows/cards;
- quick action controls;
- mobile staff layout;
- internal comment UI.

### Tests

- queue filter tests;
- quick action flow tests;
- responsive UI smoke tests;
- permissions in workspace tests.

### Docs

- staff workspace spec;
- concierge guide updates;
- property admin guide updates.

---

## 10. Epic 9 — Technician Workflow

### Database

- technician specialization fields;
- `started_at`, `resolution_note`, `requires_follow_up`;
- result photos relation;
- workload fields if needed.

### Backend/API

- technician-specific queue endpoints;
- take-in-work endpoint;
- resolution endpoint;
- waiting status transitions;
- technician KPI events.

### Frontend/UI

- technician dashboard;
- technician request detail;
- in-progress actions;
- result upload UI;
- resolution form.

### Tests

- technician-only visibility tests;
- state machine tests;
- result submission tests;
- KPI event tests.

### Docs

- technician workflow spec;
- technician user guide;
- request statuses spec.

---

## 11. Epic 10 — Contractor Model

### Database

- `contractor_companies`;
- `contractor_users`;
- contractor-property relation;
- contractor assignment fields;
- contractor access expiry.

### Backend/API

- contractor auth/access rules;
- contractor queue endpoint;
- contractor assignment endpoints;
- limited detail payloads;
- contractor completion endpoints.

### Frontend/UI

- contractor task list;
- limited request detail UI;
- contractor result submission UI;
- contractor access state messaging.

### Tests

- contractor scope tests;
- access expiry tests;
- limited payload tests;
- contractor completion flow tests.

### Docs

- contractor model spec;
- contractor guide;
- contractor access policy alignment.

---

## 12. Epic 11 — Resident Communication

### Database

- announcements fields;
- documents fields;
- read state markers if needed;
- urgent banner state.

### Backend/API

- announcements CRUD;
- documents CRUD;
- active content filtering;
- resident content endpoints.

### Frontend/UI

- announcements feed;
- document list/detail;
- urgent banner UI;
- admin publishing UI.

### Tests

- content publish visibility tests;
- active/expired filtering tests;
- resident read flow tests.

### Docs

- communication module spec;
- content management admin notes.

---

## 13. Epic 12 — Notifications Infrastructure

### Database

- push subscriptions;
- notification logs;
- channel status fields;
- delivery failure counters;
- notification preferences fields.

### Backend/API

- subscribe/unsubscribe endpoints;
- dispatch service;
- provider adapters;
- retry logic;
- delivery log endpoints.

### Frontend/UI

- notification preferences screen;
- subscription prompts;
- delivery health widgets for admin if included;
- resident notification center states.

### Tests

- provider adapter tests;
- retry/deactivation tests;
- preference enforcement tests;
- notification flow integration tests.

### Docs

- notification architecture spec;
- provider config notes;
- admin setup guide.

---

## 14. Epic 13 — Packages Workflow

### Database

- `packages`;
- recipient references;
- pickup fields;
- reminder fields.

### Backend/API

- create package;
- list packages;
- pickup endpoint;
- reminder job;
- resident package visibility endpoint.

### Frontend/UI

- staff package registration UI;
- package queue/list;
- pickup confirmation UI;
- resident package status view.

### Tests

- package registration tests;
- pickup flow tests;
- reminder job tests.

### Docs

- package workflow spec;
- concierge guide updates.

---

## 15. Epic 14 — Property Admin Console

### Database

- property settings extension;
- role assignment support tables if needed;
- audit filters/storage support.

### Backend/API

- staff management endpoints;
- role update endpoints;
- settings endpoints;
- property analytics endpoints;
- property audit endpoints.

### Frontend/UI

- staff management screens;
- role assignment forms;
- settings panels;
- property analytics screen;
- audit log screen.

### Tests

- property admin permission tests;
- staff role assignment tests;
- settings persistence tests.

### Docs

- property admin guide;
- property settings spec.

---

## 16. Epic 15 — Management Company Layer

### Database

- `management_companies`;
- company admin mappings;
- company-property mappings;
- portfolio settings if needed.

### Backend/API

- management company auth/visibility;
- portfolio analytics endpoints;
- property portfolio listing;
- shared template or policy endpoints.

### Frontend/UI

- portfolio dashboard;
- cross-property comparison views;
- SLA overview for company;
- issue hotspot views.

### Tests

- cross-property isolation tests;
- company admin permission tests;
- portfolio aggregation tests.

### Docs

- management company model spec;
- management company admin guide.

---

## 17. Epic 16 — Analytics & Management Reporting

### Database

- event tables or event-ready fields;
- aggregation support tables/materialized views if needed;
- CSV export support metadata if needed.

### Backend/API

- KPI endpoints;
- object analytics endpoints;
- portfolio analytics endpoints;
- export endpoints;
- notification health endpoints.

### Frontend/UI

- object dashboards;
- portfolio dashboards;
- KPI cards;
- charts/tables;
- CSV export actions.

### Tests

- KPI correctness tests;
- aggregation tests;
- export tests;
- permission tests for analytics.

### Docs

- metric definitions;
- analytics spec;
- reporting glossary.

---

## 18. Epic 17 — Onboarding & Data Import

### Database

- staging/import support tables if needed;
- import job status tables if needed;
- validation error storage if needed.

### Backend/API

- import endpoints;
- validation service;
- import processing jobs;
- error report endpoints;
- launch workflow support endpoints.

### Frontend/UI

- import upload UI;
- import preview;
- import error state;
- launch checklist UI if implemented in product;
- property creation wizard.

### Tests

- CSV validation tests;
- import idempotency tests;
- rollback/error handling tests.

### Docs

- import format guide;
- launch guide;
- onboarding checklist.

---

## 19. Epic 18 — Legal & Compliance Baseline

### Database

- consent timestamps;
- audit fields;
- deletion markers;
- retention-relevant flags;
- data subject request tables/fields;
- consent version/source fields;
- sensitive data classification fields;
- access review timestamps if needed.

### Backend/API

- consent storage endpoints;
- deletion/anonymization flows;
- data subject export/correction/delete request flows;
- sensitive-data masking helpers;
- access review support endpoints if needed;
- audit export support if required.

### Frontend/UI

- consent UI;
- privacy-related account states;
- data export/deletion request admin states;
- sensitive-data masking states;
- admin-facing deletion controls if applicable.

### Tests

- consent persistence tests;
- anonymization/deletion tests;
- data subject request tests;
- masking/visibility tests;
- audit logging tests.

### Docs

- полный legal packet;
- compliance policies;
- controller/processor model;
- data localization and ИСПДн readiness memo;
- biometric exclusion / feature-gating policy;
- incident response docs.

---

## 20. Epic 19 — Integrations Layer

### Database

- `webhooks`;
- `webhook_deliveries`;
- integration config tables;
- provider secret references.
- hardware device registry for SKUD, barriers/gates, intercoms, LPR and cameras where needed;
- GIS ЖКХ / ОСС export job metadata where needed.

### Backend/API

- webhook CRUD;
- delivery engine;
- retry logic;
- integration settings endpoints;
- provider adapter interfaces.
- hardware integration adapter interfaces;
- GIS ЖКХ / ОСС export helpers.

### Frontend/UI

- integration settings screens;
- webhook management UI;
- delivery/error visibility UI.
- hardware integration map UI;
- GIS ЖКХ / ОСС export/readiness status UI.

### Tests

- retry logic tests;
- signature tests;
- provider adapter tests;
- integration failure handling tests.
- hardware fallback boundary tests.

### Docs

- integrations spec;
- provider config docs;
- hardware integration map docs;
- GIS ЖКХ / ОСС readiness docs;
- troubleshooting docs.

---

## 21. Epic 20 — Growth Modules

### Database

- meter readings tables;
- billing tables;
- booking tables;
- payment references;
- automation config tables.

### Backend/API

- meter APIs;
- OCR adapter;
- billing APIs;
- booking APIs;
- automation APIs.

### Frontend/UI

- meter submission UI;
- billing screens;
- booking calendar;
- automation settings.

### Tests

- per-module functional tests;
- permission tests;
- regression tests against core.

### Docs

- per-module specs;
- onboarding and admin updates;
- pricing/packaging notes if relevant.

---

## 22. Как использовать этот документ

### Для product

- выделять scope спринта;
- проверять, что эпик не считается готовым без всех пяти типов работ.

### Для engineering

- создавать задачи отдельно на `database`, `API`, `UI`, `tests`, `docs`;
- не допускать “backend готов, документации нет”.

### Для delivery

- собирать sprint scope из вертикальных slices;
- проверять Definition of Done по всем слоям.

---

## 23. Итог

Любой важный модуль DomHub должен быть завершён только тогда, когда для него есть:
- модель данных;
- backend/API;
- UI;
- тесты;
- документация.

Если хотя бы один из этих слоёв отсутствует, эпик нельзя считать завершённым по-настоящему.

