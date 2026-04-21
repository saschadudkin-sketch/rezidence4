# DomHub — Приоритетный список недостающих документов

Дата: 2026-04-21  
Статус: рабочий gap list  
Назначение: зафиксировать, каких документов ещё не хватает для production-grade разработки DomHub и в каком порядке их создавать.

---

## 1. Вывод

Для старта разработки у DomHub уже есть сильная продуктовая и организационная база.  
Для доведения продукта до production-ready состояния не хватает в первую очередь **строгих инженерных и контрактных спецификаций**, которые переводят roadmap в реализуемые модели данных, API, правила доступа и тестовые критерии.

---

## 2. Приоритеты

### P0 — обязательно до середины активной разработки

Без этих документов команда почти неизбежно начнёт расходиться в реализации.

1. `domhub-access-data-model-spec.md`
   - Полная ERD/data model spec для access-platform.
   - Что закрывает: сущности, поля, связи, platform DB vs property DB, индексы, ограничения, ownership.

2. `domhub-access-api-contract-spec.md`
   - Контракты API для resident/security/admin/company/platform слоёв.
   - Что закрывает: endpoints, schemas, auth, role/scope rules, error codes.

3. `domhub-access-policy-spec.md`
   - Спецификация правил доступа.
   - Что закрывает: access types, zones, points, policies, approval logic, override logic, blacklist/watchlist.

4. `domhub-state-machines-spec.md`
   - Строгие state machine таблицы.
   - Что закрывает: access lifecycle, request lifecycle, incident lifecycle, contractor/service access lifecycle.

5. `domhub-test-strategy-spec.md`
   - Единая стратегия тестирования.
   - Что закрывает: unit/integration/e2e/security/role-based/regression/smoke критерии.

6. `domhub-deployment-and-tenant-ops-spec.md`
   - Техническая схема развёртывания и эксплуатации multi-tenant платформы.
   - Что закрывает: tenant provisioning, migrations, backup/restore, secrets, observability, rollback.

### P1 — нужно до enterprise-like внедрений

Эти документы нужны, чтобы продавать, интегрировать и масштабировать продукт.

7. `domhub-integration-architecture-spec.md`
   - Подключение внешних СКУД и смежных систем.
   - Что закрывает: sync model, retry policy, source of truth, conflict handling.

8. `domhub-packaging-and-feature-gating-spec.md`
   - Коммерческий и продуктовый пакетный слой.
   - Что закрывает: какие функции входят в Core / Plus / Premium, что gated by feature flags.

9. `domhub-analytics-metric-definitions.md`
   - Формальная спецификация KPI.
   - Что закрывает: определения метрик, формулы, data source, aggregation scope.

10. `domhub-security-threat-model.md`
   - Threat model для доступа и персональных данных.
   - Что закрывает: attack surfaces, abuse scenarios, mitigation priorities.

### P2 — желательно для зрелой платформы

Эти документы усиливают устойчивость команды и зрелость процесса.

11. `domhub-operational-runbooks-index.md`
   - Единый индекс и карта runbooks.

12. `domhub-ui-screen-map.md`
   - Полная карта экранов и связей между ролями.

13. `domhub-event-taxonomy-spec.md`
   - Формальный словарь событий для analytics/audit/integrations.

14. `domhub-release-gate-checklists.md`
   - Формальные release gates по направлениям.

---

## 3. Что уже покрыто текущими документами

### Уже хорошо покрыто

- product vision;
- phased roadmap;
- backlog by epics;
- stream-based technical planning;
- 12-week sprint execution;
- work breakdown by engineering layer;
- legal/compliance baseline;
- onboarding and operational guides;
- access-platform master plan.

### Частично покрыто, но недостаточно строго

- data model;
- API shape;
- access policies;
- state transitions;
- integrations;
- testing;
- tenant operations.

---

## 4. Рекомендуемый порядок создания

### Волна 1

- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-state-machines-spec.md`

### Волна 2

- `domhub-access-api-contract-spec.md`
- `domhub-test-strategy-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`

### Волна 3

- `domhub-integration-architecture-spec.md`
- `domhub-analytics-metric-definitions.md`
- `domhub-packaging-and-feature-gating-spec.md`

### Волна 4

- `domhub-security-threat-model.md`
- `domhub-event-taxonomy-spec.md`
- `domhub-release-gate-checklists.md`

---

## 5. Критерий готовности документа

Документ нельзя считать готовым, если он не даёт команде однозначный ответ:

- что именно реализуется;
- где это хранится;
- кто имеет доступ;
- через какие контракты это работает;
- как это тестируется;
- что считается корректным поведением;
- что считается ошибкой;
- где проходит граница ответственности.

---

## 6. Следующий обязательный шаг

Первым обязательным документом должен быть:

- `domhub-access-data-model-spec.md`

Потому что без формализованной модели данных:
- невозможно стабильно проектировать API;
- невозможно корректно строить policy engine;
- невозможно строго считать аналитику;
- невозможно безопасно внедрять multi-tenant и role/scope logic.

