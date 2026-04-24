# Module Spec — `units` (platform-v1)

**Фаза:** 2 (Structure layer)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.1
**Миграция:** `backend/src/v1/migrations/001_buildings.sql` + `002_entrances.sql` + `003_units.sql`

---

## 1. Назначение

Трёхуровневая иерархия физической структуры объекта: `property → building → entrance → unit`.

В legacy-коде физическая структура отсутствует: «квартира» — это свободная строка `users.apartment TEXT`, по которой JOIN'ятся все операционные таблицы (`requests`, `meter_readings`, `billing_records`, `packages`). Это создаёт три проблемы:
- Нет типизации: «кв. 12», «12", «12А» — три разные сущности для БД, одна для жителя
- Нельзя адресовать многокорпусный объект (Замоскворечье — один корпус, но будущие клиенты — нет)
- Нельзя привязать `access_policy` или `announcement` к конкретному подъезду

**Почему иерархия сейчас, а не «когда появится многокорпусный объект»:**
- Pre-deployment — единственное окно, когда миграция дешёвая (нет backfill живых данных).
- `residents.unit_id` — обязательное FK в спеке; без `units` не запускается Фаза 2 целиком.
- Для одноподъездного Замоскворечья создаём 1 building + 1 entrance + N units — overhead нулевой.

---

## 2. Схема (короткая форма)

```
buildings
  id           UUID PK
  property_id  UUID NOT NULL
  code         VARCHAR(50)         (nullable, unique per property когда не null)
  name         VARCHAR(100) NOT NULL
  sort_order   INTEGER DEFAULT 0

entrances
  id           UUID PK
  building_id  UUID NOT NULL → buildings
  code         VARCHAR(50)         (unique per building когда не null)
  name         VARCHAR(100) NOT NULL
  sort_order   INTEGER DEFAULT 0

units
  id            UUID PK
  entrance_id   UUID NOT NULL → entrances
  building_id   UUID NOT NULL → buildings (денормализовано для query-скорости)
  property_id   UUID NOT NULL
  unit_number   VARCHAR(30) NOT NULL
  unit_type     ENUM(apartment/townhouse/house/commercial/utility) DEFAULT 'apartment'
  floor         INTEGER NULL
  is_active     BOOLEAN DEFAULT true
```

Индексы: `units(property_id, building_id, entrance_id, unit_number) UNIQUE`, `units(property_id)`.

---

## 3. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/buildings` | `staff` | Список корпусов (read-public) |
| `GET` | `/api/v1/buildings/:id/entrances` | `staff` | Подъезды корпуса |
| `GET` | `/api/v1/entrances/:id/units` | `staff` | Квартиры подъезда |
| `GET` | `/api/v1/units?q=&building_id=&unit_type=` | `staff` | Поиск по номеру/фильтру |
| `GET` | `/api/v1/units/:id` | `staff` + owner-resident | Детали квартиры + резиденты |
| `POST` | `/api/v1/buildings` | `property_admin` | Создать корпус |
| `POST` | `/api/v1/entrances` | `property_admin` | Создать подъезд |
| `POST` | `/api/v1/units` | `property_admin` | Создать квартиру |
| `POST` | `/api/v1/units/import` | `property_admin` | Bulk-импорт из CSV (для initial onboarding) |
| `PATCH` | `/api/v1/units/:id` | `property_admin` | Обновить номер/этаж/тип |
| `DELETE` | `/api/v1/units/:id` | `property_admin` | Soft-delete (`is_active=false`) |

Удаление корпуса/подъезда запрещено, если есть активные units (409 Conflict).

---

## 4. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `users.apartment TEXT` | `residents.unit_id UUID FK` | Парсим `apartment` → создаём `unit` если нет, линкуем FK |
| `requests.apartment`, `meter_readings.apartment`, `billing_records.apartment`, `packages.apartment` | `unit_id FK` на соответствующих v1-таблицах | Тот же mapper, что и для `users` |

Для Замоскворечья:
1. Создаём 1 `building` (`code='main', name='Главный корпус'`)
2. Создаём N `entrances` по числу подъездов
3. Для каждого уникального `users.apartment` — создаём `unit` с `unit_number` = нормализованная строка, `unit_type='apartment'`, `entrance_id` = первый подъезд (если непонятно — ставим на entrance 1, доадминим вручную)

Миграция идёт в Фазе 7 (перед go-live).

---

## 5. Acceptance criteria

- [ ] Миграции `001–003` применяются без ошибок
- [ ] `units(property_id, building_id, entrance_id, unit_number)` — уникальный индекс enforce'ится
- [ ] Все API-эндпоинты покрыты unit + integration тестами
- [ ] Bulk-импорт валидирует дубликаты и возвращает per-row errors
- [ ] Soft-delete unit'а не ломает FK из `residents` (блокируется в сервисе, если есть активные residents)

---

## 6. Открытые вопросы

1. **Composite address vs nested IDs в UI?** → **Решено:** в UI показываем «К1 / П2 / кв. 42», в API — всегда `unit_id`. Фронт резолвит по GET `/units/:id`.
2. **Коттеджный посёлок без подъездов** → **Решено:** создаём 1 building + 1 entrance («виртуальный»), `unit_type='house'`. Зрительно в UI entrance для cottage-type объектов скрывается.
3. **Переезд резидента между unit'ами** → **Не в v1.** История привязки резидента к квартирам — пост-релиз (`resident_unit_history` таблица).
