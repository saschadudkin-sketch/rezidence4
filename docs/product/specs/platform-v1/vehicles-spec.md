# Module Spec — `vehicles` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.3
**Миграция:** `backend/src/v1/migrations/008_vehicles.sql`

---

## 1. Назначение

`vehicles` — транспортные средства, зарегистрированные в рамках property. Первая first-class сущность транспортного слоя: позволяет переиспользуемые пропуска на авто, whitelist (резидентские авто проезжают без заявки), blacklist (запрещённые номера), история по госномеру.

В legacy-коде транспорт живёт в трёх не связанных местах:
- `requests.car_plate TEXT` — plate на одноразовой заявке
- `blacklist.car_plate TEXT` — stop-лист, stand-alone
- Whitelist — **не существует**

**Следствия legacy-модели:**
- Нельзя сделать «постоянный пропуск на авто резидента»
- Нельзя искать историю визитов по номеру без полнотекстового поиска
- `blacklist` не связан с owner-resident — не видно, чьё именно авто попало в стоп-лист
- Каждый въезд гостя — новая одноразовая запись `requests`, даже если приезжает 20 раз

---

## 2. Схема

```
vehicles
  id                          UUID PK
  property_id                 UUID NOT NULL
  owner_type                  ENUM(resident/staff/contractor/guest) NOT NULL
  owner_resident_id           UUID NULL → residents
  owner_staff_id              UUID NULL → staff_users
  owner_contractor_user_id    UUID NULL → contractor_users
  plate_number                VARCHAR(20) NOT NULL
  vehicle_type                ENUM(car/motorcycle/truck/service_vehicle) DEFAULT 'car'
  color                       VARCHAR(40) NULL
  brand                       VARCHAR(60) NULL
  model                       VARCHAR(60) NULL
  is_whitelisted              BOOLEAN DEFAULT false
  is_blacklisted              BOOLEAN DEFAULT false
  notes                       TEXT NULL
  created_at                  TIMESTAMPTZ
```

Индексы: `(property_id, plate_number) UNIQUE`, `is_blacklisted`, `owner_resident_id`.

**Инвариант:** ровно один из `owner_*_id` заполнен (либо все NULL при `owner_type='guest'`). Enforce в сервисе + CHECK constraint.

**Инвариант:** `is_whitelisted=true AND is_blacklisted=true` запрещено (CHECK constraint).

---

## 3. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/vehicles?plate=&owner_resident_id=&is_whitelisted=&is_blacklisted=` | `security`, `concierge`, `property_admin` | Список с фильтрами |
| `GET` | `/api/v1/vehicles/:id` | `staff` | Детали + owner |
| `GET` | `/api/v1/vehicles/by-plate/:plate` | `security` (guard-console) | Быстрый lookup при въезде |
| `POST` | `/api/v1/vehicles` | `resident` (своё авто), `property_admin` (любое) | Регистрация |
| `PATCH` | `/api/v1/vehicles/:id` | owner + `property_admin` | Редактирование |
| `POST` | `/api/v1/vehicles/:id/whitelist` | `property_admin` | Добавить в whitelist |
| `POST` | `/api/v1/vehicles/:id/blacklist` | `property_admin`, `security` | Добавить в blacklist (+ reason в audit) |
| `POST` | `/api/v1/vehicles/:id/clear-flags` | `property_admin` | Убрать whitelist/blacklist |
| `DELETE` | `/api/v1/vehicles/:id` | owner + `property_admin` | Удаление (hard delete если нет истории, soft иначе) |

Нормализация plate: на вводе применяем `normalizePlate(input)` — upper-case, без пробелов/дефисов. Сравнение всегда по нормализованному значению.

---

## 4. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `blacklist(car_plate, reason, added_by_uid, added_at)` | `vehicles(plate_number, is_blacklisted=true, owner_type='guest', notes=reason)` | Для каждой строки blacklist создаём запись в `vehicles`; `added_by_uid/reason` → audit log с `action='vehicle.blacklisted'` |
| `requests.car_plate` where `type='car'` | lookup existing vehicle by plate; если нет — создаём `vehicles` (owner_type resolved from requester: resident → owner_resident_id) | Plate становится shadow-полем `access_requests.vehicle_id` FK |
| `requests.car_plate` where `type='pass'` | то же, но `owner_type='guest'` | |

Миграция в Фазе 7. После миграции legacy-поле `requests.car_plate` перестаёт читаться — любой запрос по номеру идёт через `vehicles.plate_number`.

---

## 5. Acceptance criteria

- [ ] Миграция `008_vehicles.sql` применяется
- [ ] UNIQUE `(property_id, plate_number)` enforce'ится (нельзя создать дубликат в рамках property)
- [ ] CHECK на exclusive owner_*_id работает
- [ ] CHECK на (NOT whitelisted AND blacklisted) работает
- [ ] `normalizePlate` — 100% покрытие unit-тестами (кейсы: кириллица vs латиница в номерах, пробелы, дефисы, regional code)
- [ ] API `by-plate` возвращает < 50ms p95 на 10k записей (index-only scan)
- [ ] Whitelist/blacklist изменения логируются в `property_audit_log` с reason

---

## 6. Открытые вопросы

1. **Кириллица в номерах:** российский номер «А123БВ77» содержит кириллицу, но в системах СКУД часто лежит как `A123BV77`. → **Решено:** `normalizePlate` транслитерирует кириллическую A/B/E/K/M/H/O/P/C/T/X/Y в латиницу. Храним в латинице. Отображаем обратно в кириллице только в UI.
2. **Shared vehicle (одно авто у двух residents в одной семье)** → **Не в v1.** Используем `owner_resident_id` = основной владелец, членов семьи не ассоциируем. Если нужно — через access_request с `created_by_resident_id != vehicle.owner_resident_id`.
3. **Whitelist = auto-approve?** → **Решено:** `vehicles.is_whitelisted=true` + `access_policy.approval_mode='auto'` для `subject_type='vehicle'` = авто-одобрение заявки. Policies — пост-релиз; до этого whitelist только инфо-флаг для охраны.
