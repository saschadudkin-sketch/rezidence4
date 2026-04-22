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
- [ ] Первый коммит Фазы 0 → PR → merge в `platform-v1` (разблокирует Фазу 1)

**Результат:** каркас для параллельной разработки готов. Команда понимает план. Спеки на первые 5 сущностей лежат в репо.

---

### Фаза 1 — Platform DB + superadmin SPA по спеке (неделя 2)

**Цель:** platform-слой (общая БД, регистрация объектов, УК, superadmin) соответствует спеке на 95%.

Миграции (`platformMigrations/`):
- `004_properties_full_spec.js` — добавить `property_type` enum, `status` enum (+ data-migration из `is_active`), `logo_url`, `primary_color`, `management_company_id NULL FK`, дефолт `plan='core'`
- `005_management_companies.js` — таблицы `management_companies`, `management_company_admins` (пустые на старте)
- `006_platform_audit_log_full.js` — добавить `actor_type`, сделать `admin_id` nullable (для system-events), добавить `management_company_id`, изменить `ip_address` на `INET`

Superadmin SPA (`frontend/src/admin/`):
- Поля `property_type` / `status` / `logo_url` / `primary_color` в форме создания и редактирования объекта
- Новая страница «Управляющие компании» (список, создание, назначение админов)
- Раздел «Бренд» в `PropertyDetailPage`

**Результат:** Фаза 1 закрывает ~30% расхождений из RECONCILIATION.md.

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

- Разморозка legacy-модулей по мере появления спек (`meters`, `billing`, `bookings`, `chat`)
- Access topology: `access_zones`, `access_points`, `access_policies` — заводится при подключении первого реального СКУД-интегратора
- Inbound integrations registry (`integrations`, `integration_events`) — для 1С, видео, внешних СКУД
- Подключение второго объекта (первый non-Замоскворечье клиент)

---

## Еженедельный статус

| Неделя | Фаза | Статус | Блокеры |
|---|---|---|---|
| W01 (2026-04-22 …) | Фаза 0 | IN_PROGRESS | — |

_Обновляется в конце каждой недели._
