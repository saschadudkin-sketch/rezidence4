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

### Фаза 0 — Подготовка инфраструктуры (неделя 1) ⚙️ `IN_PROGRESS`

- [x] Создать ветку `platform-v1` от `main` (2248bdd)
- [x] Создать директории `backend/src/v1/`, `frontend/src/v1/`, `docs/product/specs/platform-v1/`
- [x] Написать `ROADMAP.md` (этот файл)
- [x] Написать первую спеку-образец — `passes-spec.md`
- [x] Написать остальные 4 спеки-минимум: `units-spec.md`, `residents-spec.md`, `vehicles-spec.md`, `access-requests-spec.md`
- [x] Написать index `docs/product/specs/platform-v1/README.md`
- [x] Настроить CI: `.github/workflows/ci.yml` — `platform-v1` в push-триггерах; `test:coverage:critical` и `phase1-gate-summary` — advisory (continue-on-error) для этой ветки; на main всё остаётся строгим
- [x] Первый коммит Фазы 0 (`79241c3` на `platform-v1`) — scaffold готов
- [ ] Запушить `platform-v1` на remote + открыть PR `platform-v1 ← phase-0-scaffold` (опционально — или merge сразу, т.к. ветка de facto feature-branch для всего рефактора)

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

### Фаза 2 — Structure + People по спеке (недели 3–4)

**Цель:** правильная иерархия объектов и разделение пользователей по ролям.

Миграции (`backend/src/v1/migrations/`):
- `001_buildings.sql` — корпуса/дома
- `002_entrances.sql` — подъезды/входы
- `003_units.sql` — квартиры/коттеджи с `unit_type` enum, `floor`, FK на entrance
- `004_residents.sql` — резиденты с `unit_id` FK, `resident_type` enum, consent-поля
- `005_staff_users.sql` — персонал с `role` enum + capability-флаги
- `006_contractor_companies.sql` — компании-подрядчики
- `007_contractor_users.sql` — сотрудники подрядчиков

Роуты (`backend/src/v1/routes/`):
- `units.js` — CRUD, массовый импорт из CSV
- `residents.js` — CRUD + поиск
- `staff.js` — CRUD + capability-управление
- `contractors.js` — CRUD

**Важно:** старая таблица `users` **не трогается**. Новые таблицы живут параллельно до Фазы 7.

---

### Фаза 3 — Access-core по спеке (недели 5–6)

**Цель:** 4-сущностная модель access-lifecycle (`access_request → access_approval → pass → qr_pass`).

Миграции:
- `008_vehicles.sql` — plate UNIQUE per property, owner_type, whitelist/blacklist
- `009_access_requests.sql` — formal entity с `request_type` и `status` enum
- `010_access_approvals.sql` — decisions отдельной таблицей
- `011_passes.sql` — pass_type, status enum, subject-ссылки, revoke audit
- `012_qr_passes_v2.sql` — FK на `passes`, не на `requests`
- `013_visit_logs_v2.sql` — event_type / event_source enum, FK на pass + access_point
- `014_access_incidents.sql` — incident_type enum, severity, workflow
- `015_access_overrides.sql` — override_type enum, FK на incident

Роуты:
- `v1/routes/passes.js`, `vehicles.js`, `access-requests.js`, `visits.js`, `incidents.js`

**Это главная фаза** — закрывает ~50% расхождений.

---

### Фаза 4 — Фронт access-core (неделя 7)

- Резидент: заявка → `unit_id` + опциональный `vehicle_id`
- Охрана: guard-console работает с `passes` (не с `requests`), revoke button, search по vehicle
- Консьерж: карточка заявки показывает полный lifecycle

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

_Обновляется в конце каждой недели._
