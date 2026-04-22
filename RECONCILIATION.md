# DomHub — Data Model Reconciliation

**Дата:** 2026-04-22
**Источник спеки:** `docs/product/specs/domhub-access-data-model-spec.md`
**Источник кода:** `backend/src/platformMigrations.js`, `backend/src/dbMigrations.js`

Цель: честно показать, где фактическая схема БД совпадает со спекой access-platform, где расходится, а что есть в коде и не описано в спеке. Без этой сверки любой новый access-тикет рискует продублировать уже существующий код или сломать совместимость с «Резиденциями Замоскворечья».

**Легенда:**
- ✅ — есть, совпадает по ключевым полям
- 🟡 — есть, но модель отличается (требует миграции или decision)
- ❌ — нет в коде
- ➕ — есть в коде, нет в спеке (legacy / pre-MVP слой)

---

## 1. Platform DB

| Спека | Статус | Факт в коде | Расхождение |
|---|---|---|---|
| `management_companies` | ❌ | — | Сущности нет совсем. В `properties` нет FK на УК. Иерархия «УК → Объект» отсутствует. |
| `properties` | 🟡 | `platformMigrations 001/002/003` | См. ниже подробно. |
| `platform_admins` | ✅ | `platformMigrations 001` | Совпадает по полям (`id/email/password_hash/name/is_active/last_login_at/created_at`). |
| `management_company_admins` | ❌ | — | Нет вообще. Роль `management_company_admin` из role-maturity-matrix не реализована. |
| `platform_audit_log` | 🟡 | `platformMigrations 001` | См. ниже. |

### 1.1 `properties` — детальные расхождения

| Поле спеки | Поле в коде | Статус |
|---|---|---|
| `id UUID` | `id UUID` | ✅ |
| `slug VARCHAR(80) UNIQUE` | `slug VARCHAR(50) UNIQUE` | 🟡 длина меньше |
| `name VARCHAR(255)` | `name VARCHAR(255)` | ✅ |
| `management_company_id UUID FK` | — | ❌ отсутствует |
| `property_type VARCHAR(30)` enum `residential_complex/club_house/cottage_community` | — | ❌ отсутствует |
| `timezone VARCHAR(50)` | `timezone VARCHAR(100)` | ✅ |
| `address TEXT` | `address TEXT` | ✅ |
| `db_connection_url TEXT` | `db_connection_url TEXT` | ✅ |
| `status VARCHAR(20)` enum `active/suspended/maintenance/terminated` | `is_active BOOLEAN` | 🟡 двоичный флаг вместо enum — нет разделения «suspended» / «maintenance» / «terminated» |
| `plan VARCHAR(30) DEFAULT 'core'` | `plan VARCHAR(50) CHECK IN ('standard','premium','enterprise')` | 🟡 разные списки значений |
| `logo_url TEXT` | — | ❌ отсутствует |
| `primary_color VARCHAR(20)` | — | ❌ отсутствует |
| `feature_flags JSONB` | `feature_flags JSONB` | ✅ |
| `created_at/updated_at` | `created_at/updated_at` | ✅ |
| — | `hostname VARCHAR(255)` + partial unique index | ➕ не в спеке, но нужен hybrid tenant resolver |
| — | `contact_email VARCHAR(255)` | ➕ не в спеке |
| — | `contact_phone VARCHAR(50)` | ➕ не в спеке |

**Decision-пойнты:**
- Нужно ли добавить `management_company_id` сейчас или только когда появится вторая УК.
- `is_active BOOLEAN → status enum` — миграция не сложная, но повлияет на `platform/stats.js` и superadmin SPA.
- `plan` — какой список правильный: `core` из спеки или `standard/premium/enterprise` из кода.

### 1.2 `platform_audit_log` — детальные расхождения

| Поле спеки | Поле в коде | Статус |
|---|---|---|
| `actor_type VARCHAR(30)` | — | ❌ (всегда неявно «platform_admin») |
| `actor_id UUID` | `admin_id UUID REFERENCES platform_admins(id)` | 🟡 более жёсткий FK, нельзя записать system-event без admin |
| `action VARCHAR(80)` | `action VARCHAR(100)` | ✅ |
| `property_id UUID` | `property_id UUID REFERENCES properties(id)` | ✅ |
| `management_company_id UUID` | — | ❌ |
| `details JSONB` | `details JSONB` | ✅ |
| `ip_address INET` | `ip_address VARCHAR(45)` | 🟡 тип |

---

## 2. Property DB — Structure Layer

| Спека | Статус | Факт в коде |
|---|---|---|
| `buildings` | ❌ | — |
| `entrances` | ❌ | — |
| `units` (с `unit_type` enum, `floor`, связка с entrance) | ❌ | **Плоский `apartment TEXT`** в `users`, `requests`, `meter_readings`, `billing_records`, `packages`. Нет сущности «квартира». |

**Самое большое расхождение во всей модели.** Сейчас «квартира» — это свободная строка на `users.apartment`, и по ней JOIN’ятся все операционные таблицы. Перенос на формальную иерархию `property → building → entrance → unit` — большая миграция с data backfill.

**Decision-пойнт:** вводим ли иерархию сейчас, или работаем с плоским `apartment TEXT` до первого объекта, где это реально нужно (многокорпусный ЖК или коттеджный посёлок).

---

## 3. Property DB — People Layer

| Спека | Статус | Факт в коде |
|---|---|---|
| `residents` (с `unit_id`, `resident_type` enum `owner/tenant/family_member`, `consent_given_at`, `consent_version`) | 🟡 | **Всё слито в `users`**: `uid, phone, name, role, apartment, avatar, consent_accepted_at, consent_version, anonymized_at, deleted_at, property_slug`. Нет `resident_type`, нет `unit_id`. |
| `staff_users` (с `role` enum `security/concierge/technician/property_admin`, флаги `can_view_resident_phone`, `can_assign_requests`) | 🟡 | **Слито в `users.role`** — role-based, но без per-capability флагов. Гранулярные права лежат в `perms(uid, type, items)` — другая модель. |
| `contractor_companies` | ❌ | — |
| `contractor_users` | ❌ | — |

**Decision-пойнт:**
- Разносим `users` на `residents` + `staff_users` + `contractor_users` (правильно по спеке, но **очень инвазивная миграция** — затронет auth, JWT claims, десятки роутов).
- Либо расширяем `users` дополнительными nullable-полями для staff/contractor и фиксируем в спеке, что «DomHub v1 использует единую таблицу `users` с ролевой дискриминацией».

---

## 4. Property DB — Vehicle Layer

| Спека | Статус | Факт в коде |
|---|---|---|
| `vehicles` (с `owner_type`, `plate_number UNIQUE per property`, `is_whitelisted/is_blacklisted`, brand/model/color) | ❌ | Сущности нет. Plate живёт только на `requests.car_plate TEXT` и `blacklist.car_plate`. Whitelist — его нет вообще. |

**Следствие:** нельзя делать «постоянный pass на авто резидента», нельзя делать анализ по транспорту, нельзя правильно связать visit_log с vehicle.

---

## 5. Property DB — Access Topology

| Спека | Статус | Факт в коде |
|---|---|---|
| `access_zones` (zone_type enum: perimeter/residential_entry/parking/public_area/technical_area/service_area) | ❌ | — |
| `access_points` (point_type enum: gate/barrier/door/turnstile/wicket/intercom; provider/provider_external_id для SKUD-привязки) | ❌ | — |
| `access_policies` (subject/zone/point/access_method/approval_mode/schedule) | ❌ | — |

**Весь policy engine отсутствует.** Сейчас логика «кому куда можно» зашита в код (`routes/requests.js` + `routes/guardScan.js` + роли на user). Это блокирует интеграции со СКУД (нужны provider_external_id) и мульти-точечную авторизацию.

---

## 6. Property DB — Access Lifecycle

| Спека | Статус | Факт в коде |
|---|---|---|
| `access_requests` (formal entity с `request_type`, `status` enum `new/pending_approval/approved/rejected/cancelled/expired`, visitor/vehicle/unit/zone/point refs) | 🟡 | `requests` — **монолит**, смешивает access (pass, car, move_in, move_out) и service (repair, cleaning, complaint, suggestion, tech, concierge). Status хранится в `status TEXT` без enum-check. |
| `access_approvals` (отдельная таблица decisions) | ❌ | Decisions логируются как строки в `request_history(req_id, by_name, by_role, label, at)` — без формальной модели. |
| `passes` (отдельная сущность с `pass_type` enum, `subject_*` ссылки, `status` enum `active/used/expired/revoked/blocked`, revoke audit) | ❌ | **Отдельной сущности `passes` нет.** Pass существует только неявно как `requests.type IN ('pass','car')` + `qr_passes` запись. Нельзя переиспользовать пропуск, нельзя формально отозвать. |
| `qr_passes` (`pass_id, token, render_version`) | 🟡 | Код: `qr_passes(request_id, token, expires_at, used_at, used_by_uid, invalidated_at, invalidated_reason)` — **сам несёт lifecycle пропуска**, т.к. таблицы `passes` нет. FK на `requests`, не на `passes`. |

**Это второй по важности разрыв после отсутствия hierarchy.** Весь access-lifecycle в спеке построен на четырёх сущностях (`access_request → access_approval → pass → qr_pass`), в коде — на двух (`requests → qr_passes`), причём `requests` тащит и сервисные заявки, и пропуска.

---

## 7. Property DB — Access Execution / Events

| Спека | Статус | Факт в коде |
|---|---|---|
| `visit_logs` (`event_type` enum `entry_allowed/entry_denied/exit_allowed/exit_denied/manual_admit/manual_deny/override`, `event_source` enum `domhub/skud/guard_console/import`, `pass_id` FK, `access_point_id` FK, `provider_event_id/provider_payload`) | 🟡 | Код: `visit_logs(id, user_id, request_id, visitor_name, category, car_plate, created_by_apt/name/uid, actor_name/role, result TEXT, reason TEXT, request_snapshot JSONB, timestamp, notes, clip_url)` — денормализовано, без enum’ов, без FK на pass/access_point (т.к. их нет), без source-дискриминатора. |
| `access_incidents` (`incident_type` enum с 8 значениями, severity, status workflow open/investigating/resolved/dismissed) | ❌ | Концепции «инцидент доступа» нет как отдельной сущности. Deny-события только в `visit_logs.result='denied'` + `reason`. Нет workflow расследования. |
| `access_overrides` (`override_type` enum, ссылка на incident и pass, обязательный `reason`) | ❌ | Manual override пишется как обычная строка visit_log с `result`+`reason`, без формального incident link. |

---

## 8. Access-linked Service Operations

| Спека | Статус | Факт в коде |
|---|---|---|
| `requests` (минимальная форма: `type/status/unit_id/requires_access/assigned_to_staff_id/assigned_contractor_user_id`) | 🟡 | См. п. 6. Плюс нет `unit_id` (флэт `apartment`), нет `requires_access` флага, нет `assigned_to_*`. |
| `request_access_links` (связка service-request ↔ access_request) | ❌ | — |

---

## 9. Content / Communication

| Спека | Статус | Факт в коде |
|---|---|---|
| `announcements` (`is_urgent BOOLEAN`, `starts_at/expires_at`, `created_by_staff_id`) | 🟡 | `announcements` есть, но: `type CHECK ('info'/'urgent'/'maintenance')` вместо bool, `published_at` вместо `starts_at`, `author_id` FK на `users` вместо `staff_users`, плюс `pinned/image_url/cta_label/cta_url/sort_order/deleted_at` — ➕ сверх спеки. |
| `documents` (`category VARCHAR(30)`, `file_url/body_md`, `is_public`, `sort_order`) | 🟡 | Почти совпадает. Небольшая разница: `body TEXT` вместо `body_md`, категория имеет CHECK `('rules','contacts','instructions','contracts','other')`, плюс `version/author_id/deleted_at` — ➕. |

---

## 10. Notifications / Audit

| Спека | Статус | Факт в коде |
|---|---|---|
| `notification_log` (`property_id/recipient_type/recipient_id/channel/event_type/status/payload/error_message`) | 🟡 | `notification_log(user_id FK users, channel, event_type, payload, status, error_message)` — нет `property_id` (т.к. один DB = один объект), нет `recipient_type` (всегда юзер). |
| `property_audit_log` (`property_id/actor_type/actor_id/action/entity_type/entity_id/details`) | 🟡 | В коде таблица называется **`audit_log`**: `actor_uid FK users, actor_role, action, resource_type, resource_id, changes, ip_address`. Схожая идея, но нет `property_id`, `actor_type` не абстрактный (только пользователи). |

---

## 11. Integrations

| Спека | Статус | Факт в коде |
|---|---|---|
| `integrations` (`provider, integration_type, status, settings JSONB`) | ❌ | Нет таблицы. Есть только `webhooks` (outbound subscriptions) и `routes/integrations.js` (endpoint, без per-tenant registry). |
| `integration_events` (`direction inbound/outbound, status, payload, response_payload, attempt_count`) | 🟡 | Частично покрыто `webhook_deliveries` — **только outbound**, нет inbound. Нет регистрации SKUD/video/1С events. |

---

## 12. Код, которого нет в спеке (legacy / pre-MVP)

Таблицы и модули, присутствующие в `dbMigrations.js` и роутах, но не описанные в access-data-model-spec:

### Auth / инфраструктура (оставить)
- `otp_codes`, `refresh_tokens`, `token_revocations`, `sse_clients` — стандартный auth-инфра. ✅ оставить.
- `upload_objects`, `upload_access_audit` — signed uploads. ✅ оставить.
- `push_subscriptions` — push + telegram channels. ✅ оставить, но спека говорит про `notification_log`, надо сверить связку.
- `privacy_deletion_requests` — ФЗ-152 runtime. ✅ оставить.

### Operational / ЖКХ (требует decision)
- `meter_readings` — показания счётчиков.
- `billing_records` — биллинг.
- `spaces`, `space_bookings` — бронирование общих пространств.
- `packages` — посылки от курьеров.
- `request_sla_config` — SLA per request type.
- `chat_messages` — внутренний чат.
- `perms`, `templates` — гранулярные права + шаблоны.
- `blacklist` — стоп-лист (спека предполагает `vehicles.is_blacklisted` + residents-level, но код имеет отдельный stand-alone blacklist).
- `webhooks`, `webhook_deliveries` — outbound-только.

**IMPLEMENTATION_ORDER.md п.47 явно говорит: «Do not prioritize billing, OCR, booking, AI, smart-home before the operational access core is strong».** Значит код уже содержит функциональность, которая по спеке должна быть заморожена до стабилизации access-ядра.

**Decision-пойнты:**
- **Вариант A — «Freeze legacy»:** оставить `meter_readings/billing_records/spaces/packages/chat_messages` как есть, не развивать до access-core. Минус: они уже в UI, пользователи ждут улучшений.
- **Вариант B — «Признать модули спекой»:** расширить `docs/product/specs/` новыми модульными спеками (`domhub-meters-module-spec.md`, `domhub-billing-module-spec.md` и т.д.) и формализовать их как часть DomHub core. Минус: противоречит non-goal rule IMPLEMENTATION_ORDER.
- **Вариант C — «Выдрать в отдельный продукт»:** оставить в коде Резиденций Замоскворечья, но не переносить на вторые объекты. Минус: усложняет multi-tenant, по факту превращает Замоскворечье в форк.

---

## 13. Сводная оценка

| Слой | Готовность access-core |
|---|---|
| Platform registry | ~75% (нет management_companies, нет property_type/status enums) |
| Structure layer (building/entrance/unit) | 0% |
| People layer (residents/staff/contractors) | ~30% (есть `users` с ролями, нет разделения) |
| Vehicle layer | ~5% (plate только в `requests.car_plate` и `blacklist`) |
| Access topology (zones/points/policies) | 0% |
| Access lifecycle (access_request/approval/pass/qr_pass) | ~25% (есть `requests`+`qr_passes`, но смешанная модель) |
| Access execution (visit_log/incident/override) | ~40% (visit_log есть, incident/override нет) |
| Content (announcements/documents) | ~80% (небольшие расхождения полей) |
| Notifications/audit | ~70% (есть, но без `property_id` и `actor_type`) |
| Integrations (inbound SKUD/video/1С) | ~5% (только outbound webhooks) |

**Общая готовность к access-platform-модели по спеке: ~30%.**
Но **готовность как «request-tracker + pass + guard» для одного объекта: ~75%.**

Это нормально — код эволюционировал под конкретный объект (Резиденции Замоскворечья), а спека описывает целевой DomHub как платформу.

---

## 14. Рекомендуемая последовательность миграции

В порядке убывания пользы / возрастания риска:

### Фаза 1 — низкий риск, высокая польза (1–2 недели)
1. Добавить `property_type`, `status` enum, `logo_url`, `primary_color`, `management_company_id NULL FK` в `properties` — чистые ALTER TABLE с дефолтами.
2. Добавить `actor_type` в `platform_audit_log`, расширить `admin_id` nullable для system-events.
3. Создать `management_companies` и `management_company_admins` (пусть пустые — structure ready).
4. Переименовать `audit_log` → `property_audit_log` и добавить `actor_type`, `entity_type`, `entity_id` (сейчас уже почти всё есть под другими именами).

### Фаза 2 — средний риск, core-value (2–4 недели)
5. **Ввести `vehicles`** как first-class сущность, мигрировать `blacklist.car_plate` → `vehicles.is_blacklisted=true`, мигрировать `requests.car_plate` → FK `vehicle_id` (оставить car_plate как shadow для совместимости).
6. **Ввести `passes`** как отдельную сущность, мигрировать `qr_passes.request_id` → `qr_passes.pass_id`, где `passes` создаётся из `requests.type IN ('pass','car')`. Формализовать `status` enum.
7. Ввести `access_incidents` + `access_overrides`, писать туда вместо `visit_logs.result='denied'` с денормализованным reason.

### Фаза 3 — высокий риск, долгий horizon (месяц+)
8. **Иерархия `buildings/entrances/units`** — data backfill с `users.apartment`. Требует отдельного plan-документа.
9. **Разделение `users` → `residents/staff_users/contractor_users`** — требует изменения auth, JWT claims, role middleware. Риск большой.
10. **Access topology + policies (`zones/points/policies`)** — заводится только когда появится первый интегратор СКУД, иначе overengineering.

### Не-цели этой реконсиляции
- Не трогать `meter_readings/billing/spaces/packages/chat/templates/perms` до решения по «Варианту A/B/C» из п.12.
- Не плодить новые access-enum значения без обновления `domhub-access-data-model-spec.md`.

---

## 15. Что нужно от владельца продукта для следующего шага

Прежде чем брать любой миграционный тикет из фазы 1–3, нужны решения по:

1. **Legacy-модули (ЖКХ/счётчики/бронирования/посылки/чат)** — A/B/C из п.12.
2. **Иерархия объекта** — вводим `building/entrance/unit` сейчас или работаем плоско до второго объекта.
3. **Разделение `users`** — оставляем единую таблицу с дискриминацией по `role` и формализуем это в спеке, или идём на большую миграцию.
4. **`plan` values** — `core` (из спеки) или `standard/premium/enterprise` (из кода). Биллинг non-goal, так что это в основном косметика.
5. **Management company layer** — нужен ли сейчас, или только при появлении второй УК.

После этих 5 решений можно точно выбрать первый access-тикет и открывать миграцию с предсказуемым scope.
