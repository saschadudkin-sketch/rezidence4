# DomHub — Platform v1 Roadmap (D-lite)

**Ветка:** `platform-v1`
**Стартовый коммит:** `2248bdd` (main)
**Дата старта:** 2026-04-22
**Ожидаемый срок до go-live Замоскворечья:** ~10 недель

---

## Контекст

Полный аудит кода и спеки (см. `RECONCILIATION.md`) показал расхождение ~70% между access-data-model-spec и фактической схемой БД. Продукт — в состоянии pre-deployment; клиентов нет, Замоскворечье будет первым tenant.

Выбранная стратегия — **D-lite**: не переписываем весь код с нуля, а параллельно строим `v1/` по спеке и мигрируем модули по одному. Старый код живёт в `backend/src/` и `frontend/src/` до финального переноса, новый — в `backend/src/v1/` и `frontend/src/v1/`.

**Источники истины:**
- Архитектурная спека: `docs/product/specs/domhub-access-data-model-spec.md`
- Продуктовый план: `docs/product/specs/domhub-final-product-plan.md`
- Reconciliation-отчёт: `RECONCILIATION.md`
- Module-specs для v1: `docs/product/specs/platform-v1/`
- **Полный бэклог P0–P4:** `BACKLOG.md` (ROADMAP.md покрывает только P0-блок D-lite; всё остальное — в бэклоге)

---

## Решения (закрыты)

1. **Legacy-модули ЖКХ** → **Вариант B** (признать спекой, но отфазировать: переносим `announcements/documents/packages` в Фазе 5, `meter_readings/billing/spaces/chat` откладываем до пост-релиза).
2. **Иерархия `building/entrance/unit`** → **вводим сейчас** по спеке. Замоскворечье — один комплекс, но правильная модель должна быть с самого начала.
3. **Split `users` → `residents/staff/contractors`** → **делаем в Фазе 2**. Pre-deployment state делает это безопасным.
4. **`plan` values** → `core` default (по спеке), `pro`/`enterprise` как опциональные.
5. **Management company layer** → таблицы заводим пустыми в Фазе 1, первую УК добавляем в Фазе 7 при подключении Замоскворечья.

---

## Принципы D-lite

1. **Spec-first.** Любой PR в `v1/` имеет соответствующую module-spec (1–2 страницы) в `docs/product/specs/platform-v1/`.
2. **Изоляция.** Код в `v1/` не импортирует из legacy-директорий. При необходимости — копируется, не шарится.
3. **Legacy не трогаем.** Старый код работает до фазы переноса. Это страховка.
4. **Тесты обязательны.** Всё в `v1/` покрывается unit-тестами; критические флоу — интеграционными.
5. **Нет «заодно».** Каждая фаза — по плану. Новые хотелки — в `BACKLOG.md`, на пост-релиз.
6. **Еженедельный check-in.** В конце недели — апдейт этого файла: фаза, статус, блокеры.

---

## Фазы

### Фаза 0 — Подготовка инфраструктуры (неделя 1) ✅ `DONE`

- [x] Создать ветку `platform-v1` от `main` (2248bdd)
- [x] Создать директории `backend/src/v1/`, `frontend/src/v1/`, `docs/product/specs/platform-v1/`
- [x] Написать `ROADMAP.md` (этот файл)
- [x] Написать первую спеку-образец — `passes-spec.md`
- [x] Написать остальные 4 спеки-минимум: `units-spec.md`, `residents-spec.md`, `vehicles-spec.md`, `access-requests-spec.md`
- [x] Написать index `docs/product/specs/platform-v1/README.md`
- [x] Настроить CI: `.github/workflows/ci.yml` — `platform-v1` в push-триггерах; `test:coverage:critical` и `phase1-gate-summary` — advisory (continue-on-error) для этой ветки; на main всё остаётся строгим
- [x] Первый коммит Фазы 0 (`79241c3` на `platform-v1`) — scaffold готов
- [x] ~~Запушить `platform-v1` на remote + открыть PR `platform-v1 ← phase-0-scaffold`~~ — решено работать на feature-branch напрямую, отдельный PR не нужен (ветка de facto feature-branch для всего рефактора)

**Результат:** каркас для параллельной разработки готов. Команда понимает план. Спеки на первые 5 сущностей лежат в репо.

---

### Фаза 1 — Platform DB + superadmin SPA по спеке (неделя 2) ✅ `DONE`

**Цель:** platform-слой (общая БД, регистрация объектов, УК, superadmin) соответствует спеке на 95%.

Миграции (`backend/src/platformMigrations.js`):
- [x] `004_properties_full_spec` — добавлены `property_type` enum, `status` enum (+ data-migration из `is_active`), `logo_url`, `primary_color`, `management_company_id NULL` (+ индекс); дефолт API сменён на `plan='core'`
- [x] `005_management_companies` — таблицы `management_companies`, `management_company_admins` (пустые на старте); FK `fk_properties_management_company` (ON DELETE SET NULL)
- [x] `006_platform_audit_log_full` — `actor_type` enum (default `platform_admin`), `admin_id` стал nullable (для system-events), `management_company_id` FK, `ip_address` переведён в `INET`

Backend routes:
- [x] `POST /platform/api/v1/properties` — принимает новые поля (валидация enum + https URL + CSS color + MC существует и активен)
- [x] `PATCH /platform/api/v1/properties/:slug` — расширен на новые поля; `status` синхронизируется с legacy `is_active`
- [x] `POST /platform/api/v1/properties/:slug/{enable,disable}` — пишут и `is_active`, и `status` (lockstep)
- [x] `/platform/api/v1/management-companies` — новый router (list / detail / create / patch / admins read-only)

Superadmin SPA (`frontend/src/admin/`):
- [x] `PropertiesPage.tsx` — в форме создания: `property_type`, `status`, `logo_url`, `primary_color`, MC-dropdown; в таблице: тип + статус badges
- [x] `PropertyDetailPage.tsx` — раздел «Бренд» с превью, inline-edit `property_type` / `status`, блок «Управляющая компания» со сменой через dropdown
- [x] `ManagementCompaniesPage.tsx` + `ManagementCompanyDetailPage.tsx` — список + создание + детальная страница с объектами под управлением
- [x] `Shell.tsx` / `App.tsx` — ссылка «УК» в навигации + роуты

Тесты (`backend/src/__tests__/`):
- [x] `platformMigrations.test.js` расширен блоками 004/005/006 (22 теста, все проходят)
- [x] `platformManagementCompanies.test.js` — 19 тестов на валидацию, CRUD, фильтры, audit
- [x] `platformPropertiesPhase1.test.js` — 14 тестов на новые поля POST/PATCH, status↔is_active mirror

**Результат:** Фаза 1 закрывает ~30% расхождений из RECONCILIATION.md. 55 новых unit-тестов, платформенный слой готов к регистрации первой реальной УК в Фазе 7.

---

### Фаза 2 — Structure + People по спеке (недели 3–4) ✅ `DONE`

**Цель:** правильная иерархия объектов и разделение пользователей по ролям.

Миграции (`backend/src/v1/migrations/`, JS-формат `{id, up(client)}` — переиспользует `db.migrate()`; ID-префикс `v1_` исключает коллизии в общем `schema_migrations`):
- [x] `v1_001_buildings` — корпуса/дома с частичным UNIQUE на `(property_id, code)`
- [x] `v1_002_entrances` — подъезды с FK ON DELETE RESTRICT на buildings
- [x] `v1_003_units` — квартиры/коттеджи с `unit_type` CHECK enum (`apartment`/`townhouse`/`house`/`commercial`/`utility`), `floor`, денормализация `property_id`/`building_id` рядом с FK на `entrance_id`
- [x] `v1_004_residents` — резиденты с `unit_id` FK ON DELETE RESTRICT, `resident_type` CHECK enum (`owner`/`tenant`/`family_member`), `external_uid` UNIQUE NULL (для миграции legacy `users.uid` в Фазе 7), consent-поля
- [x] `v1_005_staff_users` — персонал с `role` CHECK enum (4 значения), `specialization` CHECK enum (4 значения или NULL), capability-флаги `can_view_resident_phone`/`can_assign_requests`, case-insensitive UNIQUE `(property_id, LOWER(email))`
- [x] `v1_006_contractor_companies` — компании-подрядчики с `status` CHECK enum, case-insensitive UNIQUE имя в рамках property
- [x] `v1_007_contractor_users` — сотрудники с FK ON DELETE RESTRICT на company, `access_expires_at` + частичный индекс на активные неистёкшие

Спеки (`docs/product/specs/platform-v1/`):
- [x] `staff-users-spec.md` — schema + role-default capability-таблица (security/technician → false, concierge/property_admin → true)
- [x] `contractors-spec.md` — две таблицы + бизнес-правило «contractor_user в не-active компании → 409»
- [x] `auth-v1-spec.md` — форма будущего JWT с `subject_type`/`subject_id`/`capabilities`; **§7 решение: `requireAuthV1` в Фазе 2 не вводим, legacy `requireAuth` защищает v1-роуты через mapping `role='admin' → property_admin`**

Роуты (`backend/src/v1/routes/`, смонтированы в `registerApiRoutes.js`):
- [x] `structure.js` — `/buildings`, `/entrances`, `/units` CRUD + cross-check «entrance принадлежит building», deactivate-guard «unit всё ещё имеет active residents → 409»
- [x] `residents.js` — CRUD + self-update (ограничен `full_name`/`email`) + self-consent + phone-visibility capability-gate (`canViewPhone`: admin/concierge → видят, security → null)
- [x] `staff.js` — CRUD с audit before/after snapshots для role/capability changes; override semantics: caller boolean > role default
- [x] `contractors.js` — companies + users в одном router; business rule company-status enforced на POST /contractor-users

Тесты (`backend/src/__tests__/`):
- [x] `v1PropertyMigrations.test.js` — 25 тестов на SQL-форму миграций (CHECK enum, FK RESTRICT, partial UNIQUE, денормализация)
- [x] `v1Routes.test.js` — 34 теста: RBAC (403 на не-admin mutations), валидация UUID/phone/email, business rules (entrance↔building, unit-deactivate с residents, company-status gate), capability-flag defaults/override, audit before/after snapshots
- [x] `migrations.test.js` расширен: «skip already-applied» теперь знает о v1-миграциях
- **Итого:** 59 новых тестов, 556 total pass

**Важно:** старая таблица `users` **не трогается** (принцип D-lite §3). Новые таблицы живут параллельно до Фазы 7.

**Результат:** Фаза 2 закрывает слой Structure + People по спеке. Backend готов принимать данные резидентов/персонала/подрядчиков через `/api/v1/*` под легаси-аутентификацией; миграция данных из legacy `users` — отдельный шаг в Фазе 7.

---

### Фаза 3 — Access-core по спеке (недели 5–6) ✅

**Цель:** 4-сущностная модель access-lifecycle (`access_request → access_approval → pass → qr_pass`).

Миграции (все завершены):
- `008_vehicles.js` — plate UNIQUE per property, owner_type, whitelist/blacklist ✅
- `009_access_requests.js` — formal entity с `request_type` и `status` enum ✅
- `010_access_approvals.js` — decisions отдельной таблицей ✅
- `011_passes.js` — pass_type, status enum, subject-ссылки, revoke audit ✅
- `012_qr_passes_v2.js` — FK на `passes`, не на `requests` ✅
- `013_visit_logs_v2.js` — event_type / event_source enum, FK на pass + access_point ✅
- `014_access_incidents.js` — incident_type enum, severity, workflow ✅
- `015_access_overrides.js` — override_type enum, FK на incident ✅

Роуты (все завершены):
- `v1/routes/vehicles.js` — 9 endpoints (CRUD + whitelist/blacklist/clear-flags) ✅
- `v1/routes/accessRequests.js` — 7 endpoints (create + submit/approve/reject/cancel/escalate) ✅
- `v1/routes/passes.js` — 7 endpoints (CRUD + revoke/block/unblock + qr/regenerate-qr) ✅
- `v1/routes/visits.js` — 5 endpoints (POST + verify + list + by-pass + by-plate) ✅
- `v1/routes/accessIncidents.js` — incidents + overrides (10 endpoints combined) ✅

Сервисы:
- `v1/services/verifyPass.js` — 8-веточный cascade с транзакцией + auto-incident ✅

Helpers:
- `v1/lib/normalizePlate.js` — Cyrl↔Latin (12 pairs) + `looksLikeRuPlate` regex ✅

Спеки:
- `access-requests-spec.md`, `passes-spec.md`, `vehicles-spec.md` — были в Фазе 2.
- `visit-logs-spec.md`, `access-incidents-spec.md`, `qr-verification-spec.md` — добавлены в Фазе 3 ✅

Тесты:
- `v1PropertyMigrations.test.js` — 62 shape-теста на 15 v1-миграций ✅
- `v1NormalizePlate.test.js` — 45 unit-тестов на трансилтерацию ✅
- `v1VerifyPassCascade.test.js` — 17 тестов на 8-веточный cascade ✅
- Все 46 test-suites, 655 тестов проходят без регрессий.

**Итог:** Access-core backend готов.  Оставлено на Фазу 7 (cut-over): миграция legacy `qr_passes.used_at/used_by_uid` → `visit_logs_v2`; legacy-роут `/api/v1/visit-logs` и легаси-таблица `visit_logs` продолжают работать параллельно до Фазы 7.

---

### Фаза 4 — Фронт access-core (неделя 7) ✅ `DONE`

**Цель:** дать работающий UI поверх backend access-core, не ломая legacy-фронт. Всё живёт в `frontend/src/v1/` и не импортирует ничего из legacy (D-lite §2).

Спеки:
- [x] `docs/product/specs/platform-v1/frontend-phase4-spec.md` — консолидированный план + acceptance

API-клиент (`frontend/src/v1/api/`):
- [x] `client.ts` — fetch-обёртка с X-Request-Id, CSRF, таймаутами (10с GET / 20с write), retry (2×, 100/400мс backoff) на GET
- [x] `errors.ts` — классификация (unauthorized/forbidden/not_found/conflict/validation/rate_limited/server/network/timeout/unknown) + `V1ApiError` класс
- [x] `types.ts` — UserMe, UserRole, AccessRequest, Pass, Vehicle, VisitLog, AccessIncident, Resident, и все связанные enums
- [x] Ресурсы: `session.ts`, `accessRequests.ts`, `passes.ts`, `vehicles.ts`, `visits.ts`, `accessIncidents.ts`, `residents.ts`, `units.ts`
- [x] `index.ts` — единый barrel `api.*`

Store (`frontend/src/v1/store/`):
- [x] `session.tsx` — `V1SessionProvider`, `useV1Session`, `useV1SessionState` (loading/ready/error); role-предикаты `isResidentRole`/`isStaffRole`/`isGuardRole`/`isConciergeRole`
- [x] `queryKeys.ts` — ключи для react-query (подготовка к P1); Phase 4 пока использует плоский useEffect-data-flow

UI-компоненты (`frontend/src/v1/components/`):
- [x] `ui/index.tsx` — primitives: Button, Input, Textarea, Label, Field, Card, Stack, Inline, Alert, Spinner, Badge, EmptyState, Toolbar (+ CSS-токены `uiClasses`)
- [x] `AccessRequestCard.tsx` — карточка заявки со статусом, окном, subject, guest-info
- [x] `AccessRequestForm.tsx` — форма создания (resident + concierge), валидация subject по `request_type`, ISO window validation
- [x] `AccessRequestLifecycle.tsx` — таймлайн approvals + pass + visit-logs + incidents
- [x] `PassCard.tsx` — карточка пропуска с actions (revoke/block/unblock)
- [x] `ScanPanel.tsx` — сканер QR/plate, вызов `/visits/verify`, отображение verdict
- [x] `VerifyResultCard.tsx` — карточка результата verify (allowed/denied + reason)
- [x] `VehicleCard.tsx` — карточка авто с whitelist/blacklist flip
- [x] `RoleGate.tsx` — role-based route guard с fallback на `/login` (unauthorized) / `/` (forbidden)
- [x] `formatters.ts` — русские labels для enum'ов + tone-диспатч для Badge

Страницы (`frontend/src/v1/pages/`):
- [x] `ResidentAccessPage.tsx` — landing резидента: GET `/residents/:uid` → GET `/access-requests?created_by_resident_id=...` → список + inline форма создания (unit-id + types без vehicle_access)
- [x] `GuardConsolePage.tsx` — duty station: ScanPanel слева + табы (Пропуски/Авто) справа; revoke in-place, vehicle lookup by-plate
- [x] `ConciergeRequestDetailPage.tsx` — concierge view заявки: AccessRequestCard + Lifecycle + approve/reject/escalate actions

Маршрутизация:
- [x] `V1Router.tsx` — single-file routing layer под `/v1/*`, role-based index redirect (guard > resident > concierge-landing), `<Route path="requests/:id">` bridge к page props
- [x] `App.tsx` — `<Route path="/v1/*">` с lazy-split V1Router chunk + ErrorBoundary + Suspense

Backend:
- [x] `/api/v1/users/me` теперь возвращает `property_id` (разрезолвен через `properties.slug`) — guard console использует его для `/visits/verify`

Тесты (`frontend/src/v1/`):
- [x] `store/session.role-predicates.test.ts` — truth-table для 4 предикатов × 8 ролей (10 тестов)
- [x] `components/formatters.test.ts` — enum → русский label, tone-dispatch, forward-compat для неизвестных deny-reasons, formatDateTime/formatWindow (14 тестов)
- [x] `V1Router.test.tsx` — smoke-тесты role-based редиректов (owner/tenant/security/admin/concierge) + deep-link gating (7 тестов)
- **Итого:** 3 файла, 31/31 тест зелёный

**Результат:** Phase 4 закрывает все acceptance-критерии из frontend-phase4-spec.md:
- Resident flow, guard console, concierge detail — все три surface работают на реальных `/api/v1/*` endpoints
- Role-based guards: `/v1/access` только residents, `/v1/guard` только security/admin, `/v1/requests/:id` только staff
- `npm run lint` (v1/ — 0 warnings), `npm run typecheck` (strict — 0 errors), `npm run test` в v1/ (31/31 pass), backend `test:ci` (46 suites, 655/655 pass) — все зелёные
- D-lite §2 соблюдён: `frontend/src/v1/` не импортирует из `src/{services,store,components,requests,views}`

**Осталось на Phase 7 (cut-over):** миграция легаси resident/guard/concierge экранов на v1-API или удаление легаси-surface'ов после стабилизации.

---

### Фаза 5 — Content + Notifications по спеке (неделя 8)

- `announcements_v2` — `is_urgent BOOL`, `starts_at/expires_at`, FK на `staff_users`
- `documents_v2` — `body_md`, enum `category`
- `notification_log_v2` — `recipient_type`, `recipient_id`
- `property_audit_log` — rename + `actor_type`, `entity_type`, `entity_id`
- `packages_v2` — FK на `unit_id`, связка с access

---

### Фаза 6 — Legacy-модули: перенос или заморозка (неделя 9)

- **Переносим в v1:** `announcements`, `documents`, `packages`, `perms` (с capability-моделью), `templates`
- **Замораживаем на пост-релиз:** `meter_readings`, `billing_records`, `spaces`, `space_bookings`, `chat_messages`
- Замороженные модули помечаются feature-flag `legacy_utilities_enabled`, для Замоскворечья выключены на старте

---

### Фаза 7 — Go-live Замоскворечья (неделя 10)

- Deploy platform-v1 на Timeweb по `DEPLOY.md`
- Создать через superadmin SPA: УК «Резиденции Замоскворечья» → property с hostname/branding
- Развернуть property-DB по v1-schema
- Загрузить initial data (резиденты, охрана, документы)
- Smoke-test: полный access-lifecycle end-to-end
- Переключить DNS на platform-v1
- Архивировать `legacy/zamoskvoreche-v0` (ветка + dump старой БД, если была)

---

## Пост-релиз (не в scope 10 недель)

Детальный список приоритетов — см. `BACKLOG.md`. Ключевое:

- **P0 дополнения** (параллельно с Фазами 1–7): outbox для notifications, observability per-tenant, onboarding wizard, runbook + incident process
- **P1** (недели 11–16): event sourcing для access, policy engine lite, households, self-serve trial, full E2E coverage
- **P2** (недели 17–26): native mobile app, BLE soft access, video-ID гостей, data warehouse, white-label
- **P3** (недели 27–52): partner marketplace, застройщики, smart home, AI-консьерж, репутация подрядчиков, Academy
- **P4 (parking lot):** ЕБС, парковки, ГИС ЖКХ, страховка, CRE, голосование, ресурсоснабжение

Legacy-модули ЖКХ (meters/billing/bookings/chat) — разморозка по `BACKLOG.md`, раздел «Архитектурные улучшения» и `RECONCILIATION.md §12` (Вариант B).

---

## Еженедельный статус

| Неделя | Фаза | Статус | Блокеры |
|---|---|---|---|
| W01 (2026-04-22 …) | Фаза 0 | DONE | — |
| W02 (2026-04-23 …) | Фаза 1 | DONE | — |
| W03 (2026-04-23 …) | Фаза 2 | DONE | — |
| W04 (2026-04-23 …) | Фаза 2 | DONE | — |
| W05 (2026-04-23 …) | Фаза 3 | DONE | — |
| W06 (2026-04-23 …) | Фаза 3 | DONE | — |
| W07 (2026-04-23 …) | Фаза 4 | DONE | — |

_Обновляется в конце каждой недели._
