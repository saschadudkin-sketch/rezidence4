# Deep Product / UX / UI / Frontend Audit (2026-04-05)

## Scope & approach
- Роли и сценарии: Login → role dashboard → заявки/чат/журнал/админка.
- Источники: frontend architecture (App, Dashboard, shell, hooks, styles), backend API/auth/security middleware.
- Подход: связка **UX проблема → визуальная реализация → техпричина → production-решение**.

---

## Итоговая оценка
**Уровень продукта: _развивающийся продукт_ (между рабочим MVP и почти SaaS).**

Почему:
- Есть зрелые элементы: role-based routing, SSE, retry/backoff, CSRF + HttpOnly cookies, code-splitting, тесты.
- Но до premium SaaS не хватает: доступности (focus/keyboard), консистентной дизайн-системы по breakpoints и токенам, унифицированных error/loading/empty контрактов на уровне компонентов и data-layer, а также лучшей масштабируемости состояния (контексты + ручная синхронизация уже на пределе сложности).

---

## Полный список проблем

### 1) Несогласованная адаптивная система breakpoints
- **Приоритет:** важно
- **Категория:** Responsive / UI / Architecture
- **Где:** `styles/components/*` (navigation, chat, admin-stats, utilities-polish)
- **Проблема:** В проекте одновременно используются 860/861, 760/761, 768, 600, 580 и пр.; в `tokens.css` прямо указано, что breakpoints должны быть стандартизированы, но это не соблюдается повсеместно.
- **Почему плохо:** На реальных устройствах появляются «мертвые зоны» и скачки layout при смене ширины (например tablet portrait/landscape). UX становится непредсказуемым, регрессии почти неизбежны.
- **Причина:** Отсутствие enforce-механизма для дизайн-токенов media-query (только договорённость в комментариях).
- **Как исправить:** Ввести единый слой custom media (PostCSS custom-media) и lint rule/статический чек на запрещённые raw breakpoints.
- **Пример решения:**
  ```css
  @custom-media --bp-md (min-width: 768px);
  @custom-media --bp-nav-mobile (max-width: 860px);
  @media (--bp-md) { ... }
  ```

### 2) Нет системных focus-visible состояний для интерактивов
- **Приоритет:** критично
- **Категория:** UX / UI
- **Где:** `buttons.css`, `navigation.css`, большинство `.btn-*`, `.tn-btn`, `.mn-btn`
- **Проблема:** Есть hover/active/disabled, но практически нет выделенного `:focus-visible` паттерна.
- **Почему плохо:** Клавиатурная навигация и accessibility проседают, что критично для SaaS (WCAG, enterprise-покупатели).
- **Причина:** Визуальная система не включает обязательное focus ring API.
- **Как исправить:** Добавить глобальный стандарт focus ring + исключения для mouse users.
- **Пример решения:**
  ```css
  :where(button,[role="button"],a,input,select,textarea):focus-visible {
    outline: 2px solid var(--g2);
    outline-offset: 2px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--g2) 25%, transparent);
  }
  ```

### 3) Смешение UI и domain/data-логики в гигантском AppStore
- **Приоритет:** важно
- **Категория:** Frontend / Architecture / Scalability
- **Где:** `frontend/src/store/AppStore.tsx`
- **Проблема:** Один файл совмещает state orchestration, persistence debounce, action routing, бизнес-операции, публичные хуки.
- **Почему плохо:** Высокая когнитивная сложность, сложнее онбординг разработчиков, выше риск side-effect багов и конфликтов при параллельной разработке.
- **Причина:** Исторический рост файла + отсутствие строгого boundary между domain/services/store.
- **Как исправить:** Разделить на слои: `store/core`, `store/actions`, `store/persistence`, `store/selectors`; вынести side-effectful action creators в service/usecase слой.
- **Пример решения:** Ввести feature modules (`requests`, `chat`, `users`) с собственными reducers/selectors/effects и contract tests.

### 4) Избыточное ручное управление SSE event bus через `window.dispatchEvent`
- **Приоритет:** важно
- **Категория:** Frontend / Architecture / Performance
- **Где:** `backendProvider.ts`, `useLiveSync.ts`, `utils/events`
- **Проблема:** Реактивность держится на custom events в `window`, часть состояния соединения распределена между менеджером SSE, хукaми и Dashboard retry key.
- **Почему плохо:** Скрытые связи между модулями, сложная диагностика race-condition/дублирующих подписок, риск утечек при масштабировании.
- **Причина:** Event-driven обход ограничений текущей архитектуры.
- **Как исправить:** Централизовать transport state machine (например, `RealtimeClient` + observable store), где reconnect/status/activity — единый источник истины.
- **Пример решения:** `realtimeStore` с explicit состояниями: `idle|connecting|live|degraded|failed-permanent`.

### 5) Неполный и неоднородный UX контракт для empty/loading/error по экранам
- **Приоритет:** важно
- **Категория:** Product / UX / UI
- **Где:** роль-экраны и табы, RoleContentRouter fallback, локальные state-block’и
- **Проблема:** Есть skeleton/error элементы, но нет единого product-level стандарта состояния для каждого critical user flow.
- **Почему плохо:** Пользователь видит разные паттерны на похожих операциях; падает доверие и предсказуемость.
- **Причина:** Состояния реализуются локально в компонентах, а не через общий UI-state contract.
- **Как исправить:** Ввести `StateBlock` policy matrix: `initial-loading`, `background-refresh`, `empty-first-use`, `empty-filtered`, `recoverable-error`, `terminal-error`.
- **Пример решения:** чеклист в PR: каждый новый экран обязан покрыть 5 состояний и их CTA.

### 6) Навигация через URL + локальный state создаёт риск расхождений
- **Приоритет:** желательно
- **Категория:** UX / Frontend
- **Где:** `useNavigation.ts`, `NavigationContext`
- **Проблема:** activeTab одновременно выводится из URL и поддерживается локальным state + флаги предотвращения циклов.
- **Почему плохо:** В edge cases (быстрые переходы, query-параметры, role switch) возможны временные несоответствия UI и URL.
- **Причина:** Гибридный подход вместо полного derivation from router state.
- **Как исправить:** Делать URL единственным источником active tab, локально держать только transient UI (highlight, drawer open).
- **Пример решения:** удалить `activeTab state`, использовать `useParams()` + memoized selectors.

### 7) Дизайн-токены внедрены частично: много «наследия» и hardcoded стилей
- **Приоритет:** желательно
- **Категория:** UI / Architecture
- **Где:** компоненты CSS (`navigation.css`, `buttons.css`, `utilities-polish.css`)
- **Проблема:** Встречаются raw rgba/px и неоднородные значения, несмотря на token layer.
- **Почему плохо:** Сложно поддерживать theme consistency, быстрее накапливается визуальный «шум».
- **Причина:** Миграция на токены не завершена.
- **Как исправить:** токенизация spacing/typography/elevation + stylelint запрет на raw значения вне `tokens.css`.
- **Пример решения:** заменить `padding: 0 18px` на `padding-inline: var(--space-md-plus)` (или расширить шкалу токенов).

### 8) Авторизация/сессия: UX при истечении сессии резкий и без recovery path
- **Приоритет:** важно
- **Категория:** UX / Security / Product
- **Где:** `apiClient.ts`, `useAuth.ts`
- **Проблема:** При исчерпании refresh пользователь возвращается на Login; нет мягкого «сессия истекла, продолжить вход» с контекстом незавершённого действия.
- **Почему плохо:** Потеря контекста, особенно на длинных формах/модалках, раздражение и drop-off.
- **Причина:** Security flow реализован корректно технически, но без UX-recovery сценария.
- **Как исправить:** добавить session-expired modal с сохранением intent (pathname/query/form draft) и безопасным restore после повторного входа.
- **Пример решения:** `postLoginRedirect` + `draft snapshot` в sessionStorage (без PII/секретов).

### 9) `requestsProvider.getAll` делает fan-out по страницам без лимита конкурентности
- **Приоритет:** важно
- **Категория:** Performance / Frontend
- **Где:** `backendProvider.ts`
- **Проблема:** После первой страницы остальные грузятся `Promise.all` одномоментно.
- **Почему плохо:** При больших объёмах возможны всплески нагрузки на API/БД, увеличенный tail latency, нестабильность на медленных сетях.
- **Причина:** Оптимизация времени ответа без backpressure.
- **Как исправить:** Ограничить конкурентность (p-limit 3–5), поддержать incremental render.
- **Пример решения:** `for await` батчами по 3 страницы + merge в store.

### 10) Непрозрачная стратегия data-layer: React Query подключён, но не является фактическим стандартом
- **Приоритет:** важно
- **Категория:** Architecture / Frontend
- **Где:** `App.tsx`, hooks/services
- **Проблема:** QueryClient есть, но основная часть данных живет в custom store + SSE. Новые разработчики получают двойной подход и сложные решения “где хранить”.
- **Почему плохо:** Архитектурный дрейф, дублирование логики loading/error/cache invalidation.
- **Причина:** Переходная архитектура без строгих правил границ.
- **Как исправить:** Зафиксировать RFC: какие домены остаются event-sourced (SSE store), какие переводятся на TanStack Query; описать migration cookbook.
- **Пример решения:** `queries/*` для read models, `realtime/*` для stream models.

### 11) Недостаточная продуктовая ясность CTA и последствий действий в критичных сценариях
- **Приоритет:** важно
- **Категория:** Product / UX
- **Где:** заявки, подтверждение/отклонение, удаление, blacklist, admin actions
- **Проблема:** Действия есть, но не всегда явно сообщается эффект (кто уведомится, можно ли отменить, irreversible ли операция).
- **Почему плохо:** Ошибки операторов (консьерж/охрана/админ) и недоверие к системе.
- **Причина:** UI-копирайт и подтверждения не унифицированы как decision-support.
- **Как исправить:** Ввести «action impact text» в confirm dialogs + undo, где возможно.
- **Пример решения:** «Отклонить заявку? Гость не сможет въехать. Уведомление будет отправлено жильцу.»

### 12) Модальные и overlay сценарии требуют унифицированной accessibility-модели
- **Приоритет:** важно
- **Категория:** UX / UI / Frontend
- **Где:** `ui/Modals.tsx`, стили модалок, confirm dialogs
- **Проблема:** Много модальных паттернов, но без явного централизованного стандарта для focus trap, return focus, keyboard ESC semantics по всем видам модалок.
- **Почему плохо:** Доступность и предсказуемость взаимодействия страдают; на мобильных и с клавиатурой растет шанс «застревания».
- **Причина:** Компонентная эволюция без единого modal contract.
- **Как исправить:** один `ModalPrimitive` с обязательными a11y гарантиями и линт-ограничением на кастомные модалки.
- **Пример решения:** `@radix-ui/dialog`-style API или внутренний аналог.

### 13) Недостаточная observability на фронте для UX-SLA
- **Приоритет:** желательно
- **Категория:** Performance / Product Engineering
- **Где:** login metrics, logger, client-logs
- **Проблема:** Есть метрики логина и логи, но нет системных UX/SLA метрик (time-to-interactive per role screen, SSE reconnect MTTR, action success latency p95).
- **Почему плохо:** Трудно управлять качеством продукта как SaaS.
- **Причина:** Телеmetry частично внедрена, но не связана с продуктными KPI.
- **Как исправить:** Ввести telemetry events contract + dashboards + error budgets.
- **Пример решения:** события `ux.view_ready`, `action.submit.success`, `sse.reconnect.ms`.

### 14) Хранение демо-данных/части состояния в localStorage без строгого data lifecycle
- **Приоритет:** желательно
- **Категория:** Security / Architecture
- **Где:** AppStore persistence, demo banners/hints localStorage keys
- **Проблема:** Ключи и ttl/retention политики распределены по коду, lifecycle неполностью централизован.
- **Почему плохо:** Риск «грязного» состояния и непредсказуемых UX-эффектов после обновлений.
- **Причина:** Эволюционный рост фич demo + onboarding.
- **Как исправить:** централизованный storage registry (key schema, versioning, ttl, migration).
- **Пример решения:** `storageRegistry.ts` + автосанация устаревших ключей при boot.

### 15) Нет явного ограничения конкурентных операций в UI (double submit race на уровне UX)
- **Приоритет:** важно
- **Категория:** UX / Frontend / Reliability
- **Где:** формы создания/обновления заявок, модальные submit действия
- **Проблема:** На части сценариев rely на disabled/loading локально; нет единого request lock/intent dedup слоя на UI.
- **Почему плохо:** Дублирующие операции, непредсказуемые ответы и конфликтные тосты.
- **Причина:** Нет общего `useMutationGuard`/`command bus` для UI команд.
- **Как исправить:** единый mutation wrapper с dedupe key + optimistic lock + cancel stale.
- **Пример решения:** `runCommand('request.create', payload, { dedupeKey })`.

### 16) Performance: отсутствует системный budget и автоматический fail по chunk growth
- **Приоритет:** важно
- **Категория:** Performance / Architecture
- **Где:** build scripts частично, но не end-to-end policy
- **Проблема:** Есть `check-bundle-size.js`, но нет прозрачной продуктовой карты budget per route/chunk и контроля third-party drift.
- **Почему плохо:** Производительность деградирует незаметно до тех пор, пока не станет поздно.
- **Причина:** Инструмент есть, governance — частично.
- **Как исправить:** route-level budgets + CI gate + weekly report.
- **Пример решения:** `dashboard chunk <= 220kb gzip`, `login <= 120kb gzip`.

### 17) Product-flow для ошибок сети/сервера не различает recoverable vs non-recoverable глубоко
- **Приоритет:** важно
- **Категория:** UX / Product / Frontend
- **Где:** Dashboard connection error, API retries, toast errors
- **Проблема:** Retry присутствует, но UX-контракты разной глубины: где-то toast, где-то full-screen, где-то silent fallback.
- **Почему плохо:** Пользователь не понимает, «что делать дальше» и насколько операция безопасна.
- **Причина:** Локальные решения отдельных команд.
- **Как исправить:** единая error taxonomy (network/transient/auth/forbidden/validation/server) и соответствующие UI-policies.
- **Пример решения:** для network transient — sticky inline banner + retry; для auth expired — re-login modal.

### 18) Архитектурный риск при масштабировании ролей/тенантов
- **Приоритет:** критично
- **Категория:** Architecture / Product Scalability
- **Где:** role-based branching в router/nav/hooks + monolithic feature toggling
- **Проблема:** Добавление новой роли или варианта white-label потребует правок во многих местах (permissions, nav, titles, routing, views, hints).
- **Почему плохо:** Высокая стоимость изменений, больше regression points.
- **Причина:** Role logic не полностью data-driven.
- **Как исправить:** перейти на декларативный role manifest (tabs, capabilities, landing, policies) и генерацию UI из конфига.
- **Пример решения:** `roles/manifest.ts` + contract tests per role.

---

## TOP-10 самых критичных проблем
1. Нет системных `focus-visible` (a11y блокер для SaaS).  
2. Архитектурный риск масштабирования ролей (недостаточно data-driven).  
3. Несогласованные breakpoints и responsive drift.  
4. Гигантский AppStore как узкое место поддержки.  
5. Фрагментированная SSE/event архитектура через window events.  
6. Неунифицированные empty/loading/error UX-контракты.  
7. Резкий session-expired UX без восстановления контекста.  
8. Непрозрачный dual data-layer (Context+SSE vs React Query).  
9. Fan-out загрузка всех страниц заявок без лимита конкурентности.  
10. Отсутствие строгой governance для performance budgets на уровне маршрутов.

---

## Quick Wins (1–2 дня)
1. Добавить глобальные `:focus-visible` стили и визуальные тесты keyboard navigation.  
2. Свести breakpoints к 3–5 значениям и убрать 760/761/860/861 расхождения.  
3. Ввести единый компонент `StateBlock`-вариантов и заменить ad-hoc loading/error блоки на 2–3 ключевых экранах.  
4. Добавить session-expired modal c CTA «Войти снова» + сохранение redirect path.  
5. Ограничить конкурентность `getAll requests` (например, до 4 одновременных запросов).  
6. Добавить CI-проверку на raw media breakpoints и raw color literals вне tokens.

---

## Strategic Improvements (архитектурные)
1. **Data-layer strategy RFC:** чётко развести Query-model и Realtime-model, документировать правила.  
2. **Realtime core:** единый `RealtimeClient` c state machine и typed events вместо window bus.  
3. **Role manifest platform:** декларативный конфиг ролей/капабилити для масштабирования продукта и white-label.  
4. **Store modularization:** разбить AppStore по bounded contexts и use-case сервисам.  
5. **Design system hardening:** токены + stylelint governance + компонентная библиотека primitive-level.

---

## Что мешает выглядеть как премиальный SaaS
1. Неполная accessibility зрелость (focus-visible, modal keyboard contract).  
2. Визуальная неоднородность на переломах responsive и legacy spacing/color значения.  
3. Разный стиль обработки ошибок/пустых состояний (нет «продуктовой полировки»).  
4. Недостаток микрокопии последствий в критичных CTA (операционный UX).  
5. Нет публично измеряемых UX-SLA метрик (скорость, стабильность, восстановление).

---

## Самые слабые места архитектуры при масштабировании
1. **Role branching spread** по множеству файлов → дорого добавлять роль/тенант.  
2. **Смешанный data approach** без жёстких границ → вероятность дублирования логики и багов синхронизации.  
3. **Event orchestration через window events** → слабая наблюдаемость и сложный debug.  
4. **Большой AppStore фасад** → растущая сложность изменений и ревью.  
5. **Частичная стандартизация UI-state и токенов** → ускоренный накопительный техдолг.

---

## Практический roadmap (production SaaS)
- **Sprint 1 (stability + UX confidence):** focus-visible, breakpoint unification, session-expired recovery, state-block standard.  
- **Sprint 2 (architecture reliability):** requests concurrency cap, Realtime state machine MVP, telemetry contract (SSE/latency).  
- **Sprint 3 (scale readiness):** role manifest, store modular split, design-system lint gates, route performance budgets.

