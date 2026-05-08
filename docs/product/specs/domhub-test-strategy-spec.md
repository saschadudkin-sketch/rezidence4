# DomHub — Test Strategy Specification

Дата: 2026-04-21  
Статус: рабочая test strategy specification  
Назначение: определить, как DomHub должен тестироваться на уровне core platform и access-domain.

---

## 1. Цель документа

Документ определяет:
- какие уровни тестирования обязательны;
- какие сценарии считаются критичными;
- что блокирует релиз;
- как проверяются роли, tenant isolation, access policies и state transitions;
- какие smoke/regression/security проверки обязательны.

---

## 2. Принципы тестовой стратегии

### 2.1 Test pyramid

DomHub должен опираться на следующую структуру:

- **unit tests** — максимум бизнес-логики и validation
- **integration tests** — DB, services, middleware, auth, state transitions
- **contract tests** — API schemas and response shapes
- **E2E tests** — критичные пользовательские сценарии
- **operational smoke tests** — проверка жизнеспособности деплоя

### 2.2 Ключевой принцип

Релиз нельзя считать безопасным, если протестирован только UI или только API.  
Для каждого критичного сценария должны существовать:
- business-logic tests;
- API/integration validation;
- end-to-end happy path;
- negative access/security checks.

### 2.3 Роль multi-tenant discipline

Tenant isolation должна считаться **release-blocking областью**.  
Любой риск смешивания данных объектов — критический дефект.

---

## 3. Уровни тестирования

## 3.1 Unit tests

Покрывают:
- policy evaluation;
- state transition validation;
- SLA calculation;
- request validation;
- access decision rules;
- vehicle normalization/validation;
- blacklist/watchlist rules;
- notification routing logic.

### Unit-test обязательные объекты

- access policy engine
- request state machine
- access request state machine
- pass state machine
- incident state machine
- role/scope decision helpers
- analytics metric functions

## 3.2 Integration tests

Покрывают:
- DB interactions;
- migrations;
- tenant resolution middleware;
- auth middleware;
- route-to-service integration;
- background jobs;
- audit/event persistence;
- integration event processing.

### Integration-test обязательные зоны

- platform DB + property DB boundary
- property resolution and tenant cache
- access request lifecycle
- pass generation and QR validation
- visit log creation
- incident creation on denied/invalid flows
- assignment/SLA flows

## 3.3 Contract tests

Покрывают:
- API request/response contracts
- status codes
- error payload shapes
- enum compatibility
- backwards compatibility for `/api/v1/*`

### Contract-test обязательные эндпоинты

- access requests
- approvals
- passes
- public QR pass
- security scan
- incidents
- vehicles
- analytics
- platform/property admin endpoints

## 3.4 E2E tests

Покрывают сквозные сценарии с реальными ролями.

### Критичные E2E сценарии

1. Resident creates guest pass -> security scans -> admit  
2. Resident creates vehicle access -> security validates -> allow  
3. Resident creates request -> staff assigns -> technician resolves -> resident sees result  
4. Contractor access tied to service request  
5. Invalid QR -> incident created -> security resolves  
6. Blacklisted vehicle attempt -> deny -> incident
7. Property admin creates policy -> resident flow follows new rule
8. Cottage-community onboarding import -> provisioned КПП -> guard vehicle verify with policy decision -> manual admit
9. Management company admin sees portfolio-level access analytics without raw cross-tenant leakage

## 3.5 Smoke tests

Проверяются после деплоя:
- platform login
- resident login
- property resolution
- access request creation
- QR public page availability
- security dashboard load
- cottage-community onboarding/checkpoint/guard smoke (`e2e/v1-access-production.spec.js` with `E2E_PROPERTY_TYPE=cottage_community`)
- core analytics endpoint health

---

## 4. Test categories by risk

## 4.1 P0 / Release-blocking

Если падает хотя бы один тест из этой категории, релиз блокируется.

- tenant isolation
- auth/session integrity
- role/scope enforcement
- access policy evaluation
- QR validation correctness
- pass revocation correctness
- incident creation for critical access failures
- core request/assignment flow

## 4.2 P1 / Strongly blocking

- analytics correctness for core KPIs
- notification delivery logging
- contractor visibility limits
- vehicle access flows
- management company scoping

## 4.3 P2 / Best-effort for release

- non-critical UX details
- secondary filters
- non-core report/export screens
- optional integrations not enabled in rollout

---

## 5. Access-domain mandatory test matrix

## 5.1 Resident

Must test:
- can create own access request
- cannot see another resident’s pass
- can see own QR/public pass relation only
- cannot approve admin-only access

## 5.2 Security

Must test:
- can scan and validate QR
- can see scoped access events
- can create incident
- cannot modify platform settings
- cannot view non-scoped hidden resident data

## 5.3 Concierge

Must test:
- can assist with requests/access if policy allows
- cannot perform forbidden guard/admin actions

## 5.4 Technician

Must test:
- can see only assigned work/access-linked data
- cannot inspect unrelated resident access records

## 5.5 Contractor

Must test:
- sees only assigned tasks
- cannot see unrelated passes/incidents/vehicles
- loses access after expiry

## 5.6 Property Admin

Must test:
- can manage policies and incidents within one property
- cannot cross tenant boundary

## 5.7 Management Company Admin

Must test:
- sees only own portfolio
- can aggregate metrics across own properties
- cannot view raw cross-tenant PII unless explicitly allowed

## 5.8 Platform Admin

Must test:
- can manage registry/platform layer
- is not implicitly used for daily object operations

---

## 6. State machine testing rules

Для каждой state machine должны быть тесты на:
- valid transition
- forbidden transition
- terminal-state immutability
- actor permission for transition
- side effects (audit, notifications, analytics, pass creation)

Обязательные state machines:
- access request
- pass
- access incident
- request

---

## 7. Multi-tenant test strategy

### Обязательные сценарии

- resident from property A cannot see data from property B
- staff from property A cannot query property B entities
- management company admin only sees assigned properties
- platform analytics does not leak raw cross-tenant PII
- imports/migrations only affect target property

### Обязательные negative tests

- invalid `property slug`
- stale cache after property disable
- disabled property access attempt
- terminated property request returns terminal error behavior

---

## 8. Data integrity testing

Must validate:
- unit/building/entrance relations
- resident ownership bindings
- one property boundary for passes and vehicles
- unique QR tokens
- unique vehicle plate per property
- policy references to valid zones/points
- no orphaned audit-critical records after normal operations

---

## 9. Security testing baseline

Must cover:
- auth/session failure handling
- brute-force/rate limit behavior
- unauthorized endpoint access
- forbidden role escalation attempts
- public pass token misuse attempts
- replay attempts for one-time passes if applicable
- contractor access after expiry
- manual override audit completeness

---

## 10. Test environment strategy

### Environments

- local dev
- CI test environment
- staging/preprod
- production smoke-only

### Data strategy

- isolated test data per property
- seed fixtures for core roles
- deterministic fixtures for passes, vehicles, incidents
- synthetic data for analytics tests

---

## 11. Release gates from testing perspective

## Gate Core v2

Required:
- all P0 unit and integration tests green
- core E2E happy paths green
- tenant isolation checks green

## Gate Operations+

Required:
- technician and contractor flows green
- vehicle and incident scenarios green
- analytics baseline validated

## Gate Portfolio

Required:
- management company scoping green
- cross-property aggregation verified

## Gate Final Product

Required:
- integration smoke suite green
- deployment smoke suite green
- rollback/recovery drill validated at least once

---

## 12. CI recommendations

CI should run at minimum:
- backend unit/integration suite
- frontend unit/component suite
- contract validation suite
- targeted E2E suite for critical paths
- lint/typecheck/build

Before release candidate:
- full E2E suite
- migration test run
- staging smoke

---

## 13. Definition of test-ready feature

Фича не считается готовой к merge, если для неё нет:
- unit tests for core logic
- integration tests for persistence/permissions
- contract validation for endpoint changes
- UI/state tests where applicable
- docs updated if business behavior changed

---

## 14. Следующий связанный документ

Следующий документ, который должен идти рядом:
- `domhub-deployment-and-tenant-ops-spec.md`

Потому что часть тестовой стратегии зависит от того:
- как создаются tenants;
- как применяются миграции;
- как проходит rollback;
- как устроены staging and production smoke checks.

