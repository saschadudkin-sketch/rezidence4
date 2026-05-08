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

`unit` в DomHub v1 — это addressable dwelling/asset, а не только квартира. Для `residential_complex` это обычно квартира, для `club_house` — апартамент/квартира, для `cottage_community` — дом, таунхаус или участок.

---

## 3. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/buildings` | `staff` | Список корпусов (read-public) |
| `GET` | `/api/v1/buildings/:id/entrances` | `staff` | Подъезды корпуса |
| `GET` | `/api/v1/entrances/:id/units` | `staff` | Units выбранного entrance / placeholder |
| `GET` | `/api/v1/units?q=&building_id=&unit_type=` | `staff` | Поиск по номеру/фильтру |
| `GET` | `/api/v1/units/:id` | `staff` + owner-resident | Детали unit + резиденты |
| `GET` | `/api/v1/units/import/template?property_type=` | `property_admin` | CSV-шаблон initial onboarding для типа объекта |
| `POST` | `/api/v1/buildings` | `property_admin` | Создать корпус |
| `POST` | `/api/v1/entrances` | `property_admin` | Создать подъезд |
| `POST` | `/api/v1/units` | `property_admin` | Создать unit |
| `POST` | `/api/v1/units/import` | `property_admin` | Bulk-импорт из CSV (для initial onboarding) |
| `PATCH` | `/api/v1/units/:id` | `property_admin` | Обновить номер/этаж/тип |
| `DELETE` | `/api/v1/units/:id` | `property_admin` | Soft-delete (`is_active=false`) |

Удаление building/entrance запрещено, если есть активные units (409 Conflict).

---

## 3.1 Import template and onboarding contract

`GET /api/v1/units/import/template?property_type=cottage_community` MUST return `text/csv` with these headers:

```csv
sector_or_street,house_or_plot_number,unit_type,owner_full_name,phone,resident_type,vehicle_plates,checkpoint_name,checkpoint_type,checkpoint_notes
```

`POST /api/v1/units/import` accepts either:

- `Content-Type: text/csv` with the same headers as the template;
- `Content-Type: application/json` with `{ property_id, property_type, rows }`;
- `Content-Type: application/json` with `{ property_id, property_type, csv }`.

For `property_type='cottage_community'`:

- `sector_or_street` maps to `buildings.name`;
- a technical hidden `entrance` row is created/reused as `code='virtual'`, `name='Без подъезда'`;
- `house_or_plot_number` maps to `units.unit_number`;
- `unit_type` MUST be `house`, `townhouse`, or `utility`;
- `owner_full_name`, `phone`, and `resident_type` create/reuse a resident row;
- `vehicle_plates` MAY contain semicolon-separated resident vehicle plates; they are normalized and created as whitelisted resident vehicles;
- `checkpoint_name` / `checkpoint_type` are returned as `planned_access_points` and provisioned idempotently into `access_zones` / `access_points`.

The import response MUST include `imported`, `skipped`, `warnings`, `planned_access_points`, `access_topology`, and `readiness`. `readiness.ready=false` means onboarding is not complete yet, but import rows may still be accepted so admins can load homes first and vehicles/checkpoints later.

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

## 5. Property-type modes

### 5.1 Residential complex mode

Для `property_type='residential_complex'` иерархия читается буквально:

- `building` = корпус;
- `entrance` = подъезд;
- `unit` = квартира / помещение.

Display address examples:
- `К1 / П2 / кв. 42`
- `Корпус A / Подъезд 1 / кв. 12А`

### 5.2 Club house mode

Для `property_type='club_house'` labels могут быть мягче:

- `building` = корпус / секция;
- `entrance` = вход / лобби;
- `unit` = апартамент / квартира.

Display address examples:
- `Секция A / Лобби / ап. 17`
- `Главный корпус / ап. 4`

### 5.3 Cottage community mode

Для `property_type='cottage_community'` v1 не вводит отдельные таблицы `streets`, `land_plots` или `houses`. Вместо этого:

- `building` используется как сектор, улица, очередь или "территория";
- `entrance` используется как технический placeholder внутри сектора;
- `unit` хранит дом/участок с `unit_type='house'` или `townhouse`;
- `unit_number` хранит отображаемый номер дома/участка.

Display address examples:
- `ул. Сосновая / дом 14`
- `Сектор B / участок 27`
- `Основная территория / дом 8`

UI rule:
- resident/staff UI не показывает слово "подъезд" для cottage-type объектов, если это placeholder;
- guard console primary lookup для cottage-type объектов: номер авто, ФИО, дом/участок, гость/подрядчик;
- admin import template должен называться "дома/участки", а не "квартиры".

### 5.4 Future extension guardrail

Отдельные таблицы `property_areas`, `streets`, `land_plots` or `unit_address_aliases` добавляются только после пилотного требования. Они должны быть additive and preserve existing `unit_id` references.

---

## 6. Acceptance criteria

- [ ] Миграции `001–003` применяются без ошибок
- [ ] `units(property_id, building_id, entrance_id, unit_number)` — уникальный индекс enforce'ится
- [ ] Все API-эндпоинты покрыты unit + integration тестами
- [ ] Bulk-импорт валидирует дубликаты и возвращает per-row errors
- [ ] Soft-delete unit'а не ломает FK из `residents` (блокируется в сервисе, если есть активные residents)
- [x] Active v1 UI labels зависят от `property_type` и не показывают apartment-only terminology для `cottage_community`
- [x] Cottage import template поддерживает sector/street + house/plot + vehicles baseline

---

## 7. Открытые вопросы

1. **Composite address vs nested IDs в UI?** → **Решено:** в UI показываем «К1 / П2 / кв. 42», в API — всегда `unit_id`. Фронт резолвит по GET `/units/:id`.
2. **Коттеджный посёлок без подъездов** → **Решено:** создаём 1 building + 1 entrance («виртуальный»), `unit_type='house'`. Зрительно в UI entrance для cottage-type объектов скрывается.
3. **Переезд резидента между unit'ами** → **Не в v1.** История привязки резидента к квартирам — пост-релиз (`resident_unit_history` таблица).
