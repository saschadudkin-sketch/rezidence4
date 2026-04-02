# План исправления по deep-аудиту (A-01…A-15)

**Дата:** 2026-04-02  
**Основа:** `DEEP_AUDIT_2026-04-02.md`  
**Цель:** перевести продукт из состояния «сильный production prototype» в «зрелый SaaS» за счёт системных улучшений UX, UI, frontend-архитектуры и надежности.

---

## 1) Принципы реализации

1. **Сначала reliability, потом polishing.** Любые UX/UI улучшения не должны идти раньше стабилизации auth/csrf/permissions контрактов.
2. **Вертикальные срезы.** Каждая итерация закрывает полный путь: дизайн → frontend → backend контракт → тесты → метрики.
3. **Definition of Done с метриками.** Каждое улучшение завершено только если есть проверяемые KPI (test pass rate, latency, task success).
4. **Без «большого взрыва».** Рефакторинг Dashboard/CSS делаем поэтапно с совместимостью.

---

## 2) Программа работ (12 недель)

## Фаза 0 (Неделя 1): Stabilization Gate — блокеры релиза

### Цели
- Закрыть критичные риски A-04, A-12.
- Зафиксировать релизный контракт окружения и API.

### Задачи
1. **Backend contract hardening** (A-04)
   - Разобрать и исправить падающие тесты: auth/csrf/perms/chat/visitLogs.
   - Ввести rule: merge blocked при падении contract-pack.
2. **CI preflight env validation** (A-12)
   - Добавить `verify:env` (schema-проверка env).
   - Подключить preflight как первый шаг CI.
3. **Release checklist update**
   - Явно описать обязательные env и rollback-шаги.

### DoD
- Backend test suite: 100% green на main.
- `frontend build` проходит в CI на валидном env.
- Contract-pack обязателен для merge.

---

## Фаза 1 (Недели 2–4): UX clarity + error-state system

### Цели
- Снизить когнитивную нагрузку и улучшить предсказуемость сценариев (A-03, A-05, A-08, A-11).

### Задачи
1. **Login UX uplift** (A-05)
   - Stepper 1/2, inline errors, resend timer, объясняющие сообщения.
2. **Unified state components** (A-08)
   - Компонент `StateBlock`: loading / empty / error / retry.
   - Внедрить в ключевые списки (заявки, чат, журналы, black list).
3. **Navigation semantics parity** (A-03)
   - Mobile nav: count badges (не только dot), единая семантика с desktop.
4. **Role IA harmonization v1** (A-11)
   - Единый каркас названий разделов, role-specific скрытие только вторичных вкладок.

### DoD
- UX usability smoke-test: +20% к task completion в сценариях входа и обработки заявки.
- Снижение «ошибочных повторных действий» на login.
- Все ключевые экраны используют единый state pattern.

---

## Фаза 2 (Недели 5–8): Design system + responsive refactor

### Цели
- Повысить визуальную зрелость и снизить стоимость UI-изменений (A-02, A-06, A-09, A-13).

### Задачи
1. **CSS decomposition** (A-02)
   - Разбить `theme.css` на слои:
     - `tokens.css`
     - `foundations.css`
     - `components/*.css`
     - `features/*.css`
2. **SaaS visual language kit** (A-06)
   - Нормализовать карточки, заголовки секций, кнопки, статусы, пустые состояния.
3. **Responsive content strategy** (A-09)
   - Заменить скрытие колонок на mobile stacked/disclosure паттерны.
4. **A11y hardening** (A-13)
   - Убрать рискованные global focus reset, добавить a11y checks (axe/playwright).

### DoD
- `theme.css` не является single-point-of-failure.
- UI-kit покрывает ≥80% экранов (по компонентам).
- Mobile usability review без критических data-loss кейсов.
- A11y baseline: keyboard/focus checks green.

---

## Фаза 3 (Недели 9–12): Frontend platformization + performance

### Цели
- Снизить архитектурную сложность и стабилизировать производительность (A-01, A-07, A-10, A-14, A-15).

### Задачи
1. **Dashboard decomposition** (A-01)
   - Выделить `AppShell`, `NavigationShell`, `RoleContentRouter`, `UserMenu`.
2. **Data layer modernization** (A-10)
   - Постепенно внедрить query/caching слой (TanStack Query или эквивалент).
   - Стандартизировать retry/stale/cache policies.
3. **Performance governance** (A-07, A-15)
   - Bundle analyzer + budget gates.
   - Профилировать chat/list; batch real-time updates; memoized selectors.
4. **Code hygiene / ADR cleanup** (A-14)
   - Исторические FIX-комментарии перенести в ADR/Changelog.

### DoD
- Dashboard разбит на композиционные узлы с unit coverage.
- Data-fetching стандартизирован на новых/переработанных модулях.
- Bundle budget соблюдается в CI.
- Снижение ререндеров и lag в чат/лист сценариях (по profiler).

---

## 3) Матрица соответствия (Audit → План)

- **A-01** → Фаза 3 / Dashboard decomposition
- **A-02** → Фаза 2 / CSS decomposition
- **A-03** → Фаза 1 / Navigation semantics parity
- **A-04** → Фаза 0 / Backend contract hardening
- **A-05** → Фаза 1 / Login UX uplift
- **A-06** → Фаза 2 / Visual language kit
- **A-07** → Фаза 3 / Performance governance
- **A-08** → Фаза 1 / StateBlock system
- **A-09** → Фаза 2 / Responsive content strategy
- **A-10** → Фаза 3 / Data layer modernization
- **A-11** → Фаза 1 / Role IA harmonization
- **A-12** → Фаза 0 / Env preflight + release contract
- **A-13** → Фаза 2 / A11y hardening
- **A-14** → Фаза 3 / Code hygiene + ADR
- **A-15** → Фаза 3 / Real-time batching/perf

---

## 4) RACI (кто за что отвечает)

- **Product Manager**: приоритизация, KPI, rollout-порядок.
- **UX Lead**: UX-флоу, IA harmonization, usability tests.
- **UI Lead**: дизайн-система, визуальные стандарты, компонентная спецификация.
- **Frontend Lead**: архитектура, data layer, performance governance.
- **Backend Lead**: API контракты, auth/csrf/perms стабилизация.
- **QA Lead**: contract/e2e/a11y/perf regression пакеты.
- **DevOps**: CI gates, env preflight, release checklist automation.

---

## 5) KPI и контрольные метрики

### Reliability
- Backend contract tests pass rate: **100%**.
- P0/P1 дефекты в auth/permissions после релиза: **0**.

### UX
- Login success rate (first attempt): **+15%**.
- Time-to-complete для ключевого сценария «создать/обработать заявку»: **-20%**.

### UI/Responsive
- Количество ad-hoc UI паттернов: **-50%**.
- Mobile критические UX-дефекты: **0** по итогам QA раунда.

### Performance
- JS bundle budget соблюдается (фиксированные лимиты по chunk).
- INP/TTI в целевом диапазоне на референсном устройстве.

---

## 6) Порядок внедрения по релизам

- **Release 1 (конец недели 2):** Фаза 0 завершена (блокеры reliability сняты).
- **Release 2 (конец недели 4):** Login + StateBlock + mobile nav parity.
- **Release 3 (конец недели 8):** Design system v1 + responsive refactor.
- **Release 4 (конец недели 12):** Dashboard decomposition + data platform + perf gates.

---

## 7) Быстрый старт (следующие 5 рабочих дней)

1. Создать отдельные epic’и в трекере: `Reliability`, `UX Clarity`, `Design System`, `Frontend Platform`.
2. Заморозить фичи на 1 неделю для закрытия A-04/A-12.
3. Добавить в CI: `verify:env`, contract-pack, mandatory status checks.
4. Подготовить UX-спецификацию login uplift + state components.
5. Согласовать baseline KPI и дашборд мониторинга прогресса.


---

## 8) Детализация до уровня задач (что делать команде с понедельника)

### Sprint 1 (Недели 1–2): Reliability first

- Backend:
  - Починить и стабилизировать тест-паки `auth`, `csrf`, `perms`, `chat`, `visitLogs`.
  - Зафиксировать API-контракты в OpenAPI и согласовать c frontend.
- Frontend:
  - Добавить `verify:env` и fail-fast проверку переменных окружения.
  - Привести build pipeline к предсказуемому прохождению на CI.
- QA/DevOps:
  - Включить mandatory checks: contract-pack + env preflight + frontend tests.

**Выход спринта:** релизный baseline стабилен, нет блокеров по auth/csrf.

### Sprint 2 (Недели 3–4): UX clarity

- Design/UX:
  - Спроектировать и провалидировать новый login flow (stepper + inline errors + resend).
  - Утвердить единые правила состояния экранов: loading/empty/error/retry.
- Frontend:
  - Внедрить `StateBlock` в 3 приоритетных потока: заявки, чат, журнал.
  - Привести mobile nav к той же семантике уведомлений, что и desktop.
- QA:
  - Добавить e2e smoke для login и восстановления после ошибок API.

**Выход спринта:** понятные сценарии входа и диагностируемые ошибки в ключевых экранах.

### Sprint 3 (Недели 5–6): Design System v1

- UI:
  - Разделить `theme.css` на `tokens/foundations/components/features`.
  - Зафиксировать библиотеку базовых паттернов: button, card, section header, badge, empty state.
- Frontend:
  - Мигрировать на новые слои стилизации без поломки текущей функциональности.
- QA:
  - Включить визуальные регрессии на критичных экранах.

**Выход спринта:** визуальная консистентность повышена, UI-изменения дешевле.

### Sprint 4 (Недели 7–8): Responsive hardening

- UX/UI:
  - Заменить скрытие колонок на mobile на stacked/disclosure представления.
  - Перепроверить touch targets и критические действия на телефонах.
- Frontend:
  - Убрать глобальные фокусные anti-patterns, добавить a11y-safe фокус-стили.
- QA:
  - Прогнать accessibility smoke (keyboard/focus/contrast).

**Выход спринта:** мобильный UX без потери данных и с базовой accessibility-гигиеной.

### Sprint 5 (Недели 9–10): Architecture refactor

- Frontend:
  - Разбить Dashboard на `AppShell`, `NavigationShell`, `RoleContentRouter`, `UserMenu`.
  - Начать миграцию fetching-логики на query/caching-слой.
- Backend:
  - Оптимизировать API-ответы для новых паттернов data loading.
- QA:
  - Расширить интеграционные тесты под новый роутинг/состояния.

**Выход спринта:** снижение архитектурной связности и управляемый data flow.

### Sprint 6 (Недели 11–12): Performance + governance

- Frontend:
  - Включить bundle analyzer и budget gates.
  - Оптимизировать hot paths (чат, списки, бейджи, live updates).
- Product/Engineering:
  - Зафиксировать governance: ADR, код-стандарты, правила добавления новых UI-паттернов.
- QA/DevOps:
  - Автоматизировать perf regression checks.

**Выход спринта:** устойчивый performance-контур и правила, предотвращающие возврат к хаотичной эволюции.

---

## 9) Реестр рисков и снижение

1. **Риск:** затягивание reliability-фазы из-за скрытых контрактных несовместимостей.  
   **Снижение:** freeze на фичи + ежедневный triage по контрактным багам.

2. **Риск:** параллельные UI-изменения ломают консистентность.  
   **Снижение:** единый UI review board и обязательное использование UI-kit.

3. **Риск:** миграция data layer увеличит регрессии.  
   **Снижение:** миграция по модулям, feature flags, двойные интеграционные тесты.

4. **Риск:** performance не улучшится без измерений на реальных устройствах.  
   **Снижение:** фиксированный набор референсных девайсов и еженедельный perf dashboard.

