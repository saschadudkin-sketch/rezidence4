# Deep Product/UI/Frontend Audit — 2026-04-05

## Scope
- Frontend architecture, UX-flows, visual system, responsive behavior, performance, security, reliability.
- Backend API/security/scalability decisions that directly affect frontend UX quality.
- Evidence sources: `frontend/src`, `backend/src`, build/install checks.

---

## Product maturity assessment
**Level:** **развивающийся продукт (между “рабочий MVP” и “почти SaaS”)**.

Why:
- Есть сильная базовая инженерия (RBAC, SSE, retry, CSRF, rate-limit, refresh tokens, feature docs).
- Но UX/IA сильно зависит от роли и локальных эвристик, есть хрупкие места в состояниях и supply-chain (невозможность собрать фронт из-за dev dependency).
- Есть признаки “engineering-first” продукта с недоотшлифованной product/visual orchestration.

---

## TOP-10 критичных проблем
1. **Нестабильный supply-chain фронтенда**: `npm ci` падает на несуществующей версии Storybook пакета.
2. **Deprecated API-контракты во фронтенде**: массовое использование `/api/*` вместо `/api/v1/*`.
3. **Слишком крупные orchestration-файлы** (`backendProvider.ts`, `index.js`, `AppStore.tsx`, `Login.tsx`) → рост когнитивной сложности.
4. **Навигационный state partly duplicated** (URL + local state + manual sync guards) в `useNavigation`.
5. **SSE UX деградирует после лимита retries без автоматической стратегии recovery** (перманентная ошибка через 10 попыток).
6. **Ограниченная стратегия loading/empty/error consistency** между экранами и доменами.
7. **Локальное хранение демо-данных с PII/медиа в localStorage** (пусть и с TTL) остаётся уязвимой моделью.
8. **Слабая продуктовая ясность CTA/next steps для role-based flows** (особенно onboarding + deep link entry points).
9. **Неполная visual governance**: токены есть, но живут одновременно legacy shorthand и semantic aliases.
10. **Нет enforce-пайплайна качества (lint/typecheck) на уровне npm scripts/CI contract в frontend package**.

---

## Полный список проблем (production-focused)

### 1) Frontend dependency supply-chain broken
- **Приоритет:** критично  
- **Категория:** Frontend / Architecture  
- **Где:** `frontend/package.json`, процесс CI/локальной сборки  
- **Проблема:** `npm --prefix frontend ci` не проходит: `@storybook/addon-essentials@^10.3.4` недоступен (ETARGET).  
- **Почему плохо:** разработчики/CI не могут воспроизводимо поднимать среду, блокируется delivery и auditability.  
- **Причина:** отсутствие lock/governance на реально существующие версии и preflight-проверки зависимостей.  
- **Как исправить:** зафиксировать существующие версии Storybook 10.x или downgrade до стабильного набора; добавить nightly dependency health check.  
- **Пример решения:**
  - pin exact versions in `devDependencies`;
  - добавить `npm run deps:verify` (npm view + semver validation) в CI.

### 2) Deprecated API aliases on frontend
- **Приоритет:** важно  
- **Категория:** Architecture / Frontend  
- **Где:** `frontend/src/services/providers/backendProvider.ts`  
- **Проблема:** frontend вызывает legacy маршруты `/api/*`, в backend они помечены как backward-compatible aliases с deprecation/sunset semantics.  
- **Почему плохо:** будущий remove aliases сломает клиент; растёт технический долг API migration.  
- **Причина:** migration не доведена до конца на frontend слое.  
- **Как исправить:** полностью перевести фронт на `/api/v1/*`, включить контрактный тест “no deprecated endpoint usage”.  
- **Пример решения:** codemod/central API path map + CI grep gate.

### 3) Overgrown orchestration modules
- **Приоритет:** важно  
- **Категория:** Architecture / Code quality  
- **Где:** `frontend/src/services/providers/backendProvider.ts` (554 lines), `backend/src/index.js` (559), `frontend/src/store/AppStore.tsx` (300), `frontend/src/views/Login.tsx` (295).  
- **Проблема:** большие “god-orchestrator” файлы с множеством responsibilities.  
- **Почему плохо:** труднее безопасно менять, сложнее тестировать изолированно, выше риск регрессий.  
- **Причина:** итеративное наращивание фич в существующих файлах вместо вертикальной декомпозиции.  
- **Как исправить:** выделить bounded contexts (auth-flow, sse manager, request upload pipeline, route bootstrapping).  
- **Пример решения:**
  - `backendProvider`: split into `authGateway`, `requestsGateway`, `chatGateway`, `sseManager`;
  - `index.js`: extract middleware bootstrap + route registry + lifecycle manager.

### 4) Navigation state synchronization complexity
- **Приоритет:** важно  
- **Категория:** UX / Frontend  
- **Где:** `frontend/src/hooks/useNavigation.ts`  
- **Проблема:** одновременно используются URL-derived tab, internal `activeTab`, manual flags (`navigatingRef`), отдельный redirect-effect.  
- **Почему плохо:** edge-cases back/forward, role-switch, query-driven deep-links становятся хрупкими.  
- **Причина:** постепенный переход от local state к URL-state без полного упразднения дублирования.  
- **Как исправить:** сделать URL единственным источником правды; `activeTab` derive-only; убрать sync guards.  
- **Пример решения:** custom `useTabFromRoute()` + centralized route guards at router level.

### 5) Permanent SSE failure UX lacks product-grade recovery
- **Приоритет:** важно  
- **Категория:** UX / Frontend / Reliability  
- **Где:** `frontend/src/services/providers/backendProvider.ts`, `Dashboard` connection handling  
- **Проблема:** после `MAX_SSE_RETRIES` поток переходит в permanent error state; не описан устойчивый recovery сценарий с user guidance и fallback polling.  
- **Почему плохо:** пользователь может остаться в полурабочем интерфейсе без реального live-sync.  
- **Причина:** транспортная логика сильнее продумана, чем product behavior при долгой деградации.  
- **Как исправить:** multi-stage degradation policy: SSE → long-poll fallback → explicit re-auth / reconnect wizard.  
- **Пример решения:** circuit-breaker + periodic health probe + CTA “Восстановить сессию”.

### 6) Inconsistent empty/loading/error states across domains
- **Приоритет:** важно  
- **Категория:** UX / UI  
- **Где:** роль-специфичные экраны + router fallback patterns  
- **Проблема:** есть `ReqSkeleton` и частично унифицированные экраны, но нет единого состояния-матрицы для всех доменов (chat/perms/users/history/etc.).  
- **Почему плохо:** UX непредсказуем, пользователь по-разному считывает “данных нет”, “ошибка”, “загрузка”.  
- **Причина:** state components развивались фичево, не системно.  
- **Как исправить:** внедрить global UX state contract (StateBlock variants + UX copy library + telemetry tags).  
- **Пример решения:** `StateBlock` registry per domain: `loading|empty|error|permission|offline|partial`.

### 7) localStorage as demo data store still risky for privacy/perf
- **Приоритет:** важно  
- **Категория:** Security / Performance  
- **Где:** `frontend/src/store/persistence/localStorage.ts`, `photoCache.ts`, `useAuth.ts`  
- **Проблема:** демо-PII, фото, onboarding markers сохраняются в localStorage; есть TTL и очистка, но риск shared device leakage остаётся.  
- **Почему плохо:** privacy risk + quota pressure + непредсказуемость в private mode.  
- **Причина:** выбран быстрый persistence path без строгой data classification policy.  
- **Как исправить:** минимум — encrypt-at-rest (session key) + strict separation of PII vs UI prefs; лучше — IndexedDB with scoped stores + secure wipe policy.  
- **Пример решения:** `rz_session` scoped key rotation + auto-wipe on inactivity.

### 8) Product CTA clarity is role-fragmented
- **Приоритет:** важно  
- **Категория:** UX / Product  
- **Где:** `Dashboard`, role onboarding hints, tab IA  
- **Проблема:** CTA “что делать дальше” зависит от роли, но не всегда подкреплён contextual next-step на уровне экрана.  
- **Почему плохо:** новый пользователь тратит больше времени на ориентирование; рост когнитивной нагрузки.  
- **Причина:** role-based IA есть, но journey orchestration (first task completion path) неполная.  
- **Как исправить:** goal-driven home blocks per role: “next best action”, progress, unresolved tasks.  
- **Пример решения:** dashboard hero-card с одним primary CTA + вторичным “почему это важно”.

### 9) Design system governance is half-migrated
- **Приоритет:** желательно  
- **Категория:** UI / Architecture  
- **Где:** `tokens.css`, компонентные css  
- **Проблема:** одновременно поддерживаются shorthand-токены (`--t1`, `--s2`) и semantic aliases (`--color-*`), migration незавершена.  
- **Почему плохо:** визуальная консистентность зависит от дисциплины отдельных авторов; сложнее автоматизировать дизайн-контроль.  
- **Причина:** transition period затянулся без дедлайна и авто-checker.  
- **Как исправить:** stylelint custom rule “no legacy tokens in components”, phased migration sprint.  
- **Пример решения:** CI failing rule for `var(--t1|--s0|--g1)` in new/changed files.

### 10) No explicit frontend lint/typecheck quality gate in scripts
- **Приоритет:** важно  
- **Категория:** Code quality / Frontend  
- **Где:** `frontend/package.json` scripts  
- **Проблема:** есть тесты и build, но нет first-class `lint` / `typecheck` contract в стандартном verify path.  
- **Почему плохо:** деградация читаемости/типобезопасности просачивается раньше runtime/test failures.  
- **Причина:** фокус на functional tests и build.  
- **Как исправить:** добавить `eslint`, `tsc --noEmit`, включить в `verify:all`.  
- **Пример решения:** `"verify:all": "npm run verify:env && npm run lint && npm run typecheck && vitest run && npm run build"`.

### 11) Query params cleanup can unintentionally erase unrelated params
- **Приоритет:** желательно  
- **Категория:** UX / Frontend  
- **Где:** `useNavigation.ts` (`setSearchParams({}, { replace: true })`)  
- **Проблема:** при обработке `reqId` очищаются все query params.  
- **Почему плохо:** теряются UTM/ref/debug flags и потенциальные фичевые параметры.  
- **Причина:** simplistic cleanup implementation.  
- **Как исправить:** удалять только `reqId` key.  
- **Пример решения:** clone `URLSearchParams`, `params.delete('reqId')`, then set.

### 12) Mobile nav complexity risks discoverability
- **Приоритет:** желательно  
- **Категория:** UX / Responsive  
- **Где:** `NavigationShell.tsx`, `navigation.css`  
- **Проблема:** при >N вкладок часть уходит в “Ещё”, что может скрывать high-priority разделы при роли/счётчиках.  
- **Почему плохо:** критичные сущности могут быть “второго клика”, ухудшая скорость сценариев.  
- **Причина:** fixed tab cap strategy без динамического приоритета по urgency.  
- **Как исправить:** приоритизация табов по роли + badge severity (пин критичных наверх).  
- **Пример решения:** сортировать mobile visible tabs по rule engine before render.

### 13) Accessibility gap: icon-only close/toggle controls rely on title/aria but need stronger semantics
- **Приоритет:** желательно  
- **Категория:** UI / UX  
- **Где:** banners, drawers, icon-heavy controls  
- **Проблема:** есть aria-label, но не везде есть keyboard flow и visible focus affordance consistency across custom components.  
- **Почему плохо:** клавиатурная и screen-reader навигация может быть неравномерной.  
- **Причина:** частично централизованный, но не end-to-end a11y audit per component states.  
- **Как исправить:** создать accessibility regression checklist + axe tests for critical flows.  
- **Пример решения:** Playwright + axe-core smoke tests for login/dashboard/nav/modal.

### 14) Product messaging overload on Login marketing pane vs task focus
- **Приоритет:** желательно  
- **Категория:** UX / UI  
- **Где:** `Login.tsx`  
- **Проблема:** большой marketing-блок и feature-list конкурируют с primary auth action на smaller laptops/tablets.  
- **Почему плохо:** ухудшается task completion focus для utilitarian B2B/SaaS access app.  
- **Причина:** branding-heavy layout применён к операционному входу.  
- **Как исправить:** progressive disclosure: компактный hero + раскрытие преимуществ по запросу.  
- **Пример решения:** collapsible “Возможности системы” и tighter auth-first композиция.

### 15) Error surface dispersion (toasts + full-screen + inline) without unified escalation model
- **Приоритет:** желательно  
- **Категория:** UX / Frontend  
- **Где:** Login/Dashboard/API flows  
- **Проблема:** ошибки могут показываться toast/inline/fullscreen в зависимости от контекста без единого severity protocol.  
- **Почему плохо:** пользователь труднее понимает критичность и expected action.  
- **Причина:** историческое добавление обработчиков на уровне фич.  
- **Как исправить:** ввести error taxonomy (`info/warn/recoverable/blocking/security`) + mapping на UI-channel.  
- **Пример решения:** central `errorPresenter` service.

### 16) Image upload pipeline lacks client-side compression strategy by network tier
- **Приоритет:** желательно  
- **Категория:** Performance / Frontend  
- **Где:** `backendProvider.ts` photo upload path  
- **Проблема:** валидация MIME есть, но не видно адаптивного сжатия/resize policy на клиенте перед upload.  
- **Почему плохо:** mobile latency/traffic overhead, медленные create/update flows.  
- **Причина:** focus на correctness/security, а не on-device media optimization.  
- **Как исправить:** add image preprocessing (max dimension/quality) per network hints.  
- **Пример решения:** canvas/web worker compression pipeline.

### 17) Retry and timeout policies are good but not user-transparent enough
- **Приоритет:** желательно  
- **Категория:** UX / Reliability  
- **Где:** `apiClient.ts`, connection UX  
- **Проблема:** ретраи/джиттер скрыты от пользователя; нет unified “attempt X of Y” feedback для долгих операций.  
- **Почему плохо:** воспринимается как “зависло”, растёт риск повторных кликов/дубликатов.  
- **Причина:** техническая устойчивость не связана с UX messaging layer.  
- **Как исправить:** показывать progress/hint для retrying операций и unlock cancel/retry controls.  
- **Пример решения:** transient operation banner + idempotent action state machine.

### 18) Backend bootstrap is doing too much in one runtime module
- **Приоритет:** важно  
- **Категория:** Architecture / Backend  
- **Где:** `backend/src/index.js`  
- **Проблема:** конфиг-валидация, middleware, routes, health, shutdown, cron-like jobs сосредоточены в одном файле.  
- **Почему плохо:** затрудняет безопасное развитие (например, multi-tenant, feature flags, env-specific composition).  
- **Причина:** single-file bootstrap strategy.  
- **Как исправить:** split into app factory + infra adapters + lifecycle manager.  
- **Пример решения:** `createHttpApp()`, `registerRoutes()`, `startWorkers()`, `gracefulShutdown()` modules.

---

## Quick Wins (1–2 дня)
1. Починить devDependencies (storybook versions), восстановить `npm ci`.  
2. Перевести фронтенд endpoints с `/api/*` на `/api/v1/*` (через central path constants).  
3. Добавить `lint` + `typecheck` в scripts и CI.  
4. Исправить cleanup query params (удалять только `reqId`).  
5. Ввести минимальный единый Error UX mapping (toast/inline/blocking).  
6. Добавить UX-индикатор retry state для долгих запросов.

---

## Strategic Improvements (архитектурные)
1. **URL-as-single-source navigation architecture** для role tabs/deep links.  
2. **State orchestration contract**: unified async states per domain (loading/empty/error/offline/forbidden).  
3. **Gateway decomposition** (frontend services) + anti-corruption layer for API versioning.  
4. **Design system governance automation** (stylelint tokens policy + component states matrix).  
5. **Operational resilience UX**: degradation ladder for SSE/network/auth failures.

---

## Что мешает выглядеть как премиальный SaaS-продукт
- Неполная консистентность системных состояний (loading/empty/error/offline) между модулями.
- Слишком “техническое” поведение в edge-сценариях без product-grade guidance.
- Визуальная система зрелая на уровне токенов, но governance исполнения не полностью автоматизирован.
- Login/dashboard перегружены mixed-purpose контентом (branding + operations) вместо “task-first clarity”.

---

## Самые слабые места архитектуры при масштабировании
- Зависимость от больших orchestration-модулей (изменение в одном месте задевает слишком многое).
- Неполный переход на versioned API контракт.
- Сложная синхронизация навигации (URL/state/effects), которая хрупка при росте числа ролей/табов.
- Локальные persistence решения (demo/local caches) без строгой data lifecycle policy.

---

## Связка UX → UI → Tech (коротко)
- **Пользователь не понимает состояние соединения** → баннер/ошибки неоднородны → transport retry есть, но нет product flow recovery.
- **Сложно ориентироваться в роли и действиях** → CTA/иерархия неодинаковы по вкладкам → навигационная архитектура и state contract частично дублируются.
- **Интерфейс местами “почти enterprise” но не premium SaaS** → сильные токены, но слабый enforce → нужен governance слой в CI и component quality gates.
