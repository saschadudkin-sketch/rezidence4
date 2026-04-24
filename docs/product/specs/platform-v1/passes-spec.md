# Module Spec — `passes` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft — шаблон для остальных v1 module-specs
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.5
**Миграция:** `backend/src/v1/migrations/011_passes.sql` + `012_qr_passes_v2.sql`

---

## 1. Назначение

`passes` — first-class сущность пропуска: единичное разрешение на проход/проезд для конкретного субъекта (гость, резидент, авто, подрядчик, сотрудник) в рамках одного property, ограниченное временным окном и опционально политикой/точкой доступа.

В legacy-коде пропуск существует **неявно** как `requests WHERE type IN ('pass','car')` + привязанная строка `qr_passes(request_id, token, ...)`. В platform-v1 `passes` становится отдельной таблицей, а `qr_passes` держит только QR-представление (`token, render_version`).

**Почему separate entity:**
- Один access_request может породить несколько пассов (серия визитов, основной + резервный QR).
- Пропуск можно переиспользовать и формально отозвать (`status='revoked'` + audit-поля) — без отзыва родительской заявки.
- `visit_logs.pass_id` даёт прямую связь события на конкретный пропуск, а не на заявку-монолит.

---

## 2. Схема (короткая форма, полная в мастер-спеке)

```
passes
  id                         UUID PK
  property_id                UUID NOT NULL
  access_request_id          UUID NULL    → access_requests
  pass_type                  ENUM(guest/vehicle/resident/staff/contractor/courier/service/emergency)
  subject_{resident|staff|contractor_user|vehicle}_id  UUID NULL  (XOR по subject_type)
  zone_id / point_id / policy_id    UUID NULL  (Фаза пост-релиз; nullable в v1)
  valid_from / valid_until   TIMESTAMPTZ NOT NULL
  status                     ENUM(active/used/expired/revoked/blocked)  DEFAULT 'active'
  approved_by_staff_id       UUID NULL
  revoked_at / revoked_by_staff_id / revoked_reason
  created_at                 TIMESTAMPTZ NOT NULL

qr_passes
  id              UUID PK
  pass_id         UUID NOT NULL UNIQUE → passes
  token           TEXT NOT NULL UNIQUE
  render_version  SMALLINT DEFAULT 1
  created_at      TIMESTAMPTZ NOT NULL
```

Индексы: `(property_id, status)`, `subject_vehicle_id`, `(valid_from, valid_until)`, `qr_passes.token UNIQUE`.

---

## 3. State machine

```
         ┌──────────────┐  issue_qr                  scan(allowed)
   ───►  │    active    │ ─────────► qr_issued ────────────────► used
         └──────┬───────┘                           
                │ valid_until < now
                ▼
            expired
                
         (active | used) ── admin.revoke ──► revoked
         (active) ──────── security.block ─► blocked  (temporary)
         blocked ────────── security.unblock ► active
```

Инварианты:
- `status='active'` требует `valid_from ≤ now ≤ valid_until`.
- Переход `* → revoked` — одноразовый, обязателен `revoked_reason`.
- `used` для one-shot пропусков (`pass_type IN ('guest','courier','service')`); для `resident/staff/vehicle` — многоразовое, статус не меняется на `used`.

---

## 4. API

Все роуты под `/api/v1/passes`, tenant-resolved через hostname middleware.

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/passes` | `resident`, `property_admin`, `concierge` | Создать пасс напрямую (без access_request — для staff/contractor onboarding) или из approved access_request |
| `GET` | `/api/v1/passes?status=&pass_type=&subject_vehicle_id=&q=` | `security`, `concierge`, `property_admin` | Список с фильтрами |
| `GET` | `/api/v1/passes/:id` | owner + staff | Детали пропуска + QR |
| `POST` | `/api/v1/passes/:id/revoke` | `property_admin`, `security` | Отозвать (обязателен `reason`) |
| `POST` | `/api/v1/passes/:id/block` | `security` | Временная блокировка |
| `POST` | `/api/v1/passes/:id/unblock` | `security` | Снять блокировку |
| `GET` | `/api/v1/passes/:id/qr` | owner | Получить QR-токен (свежий render_version) |
| `POST` | `/api/v1/passes/verify` | `security` (guard-console) | Scan: проверка token + запись в visit_logs |

Все mutations пишут в `property_audit_log` с `entity_type='pass'`, `entity_id=passes.id`.

---

## 5. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `requests` WHERE type='pass' | создаём `pass` + связь `access_request_id` | `pass_type='guest'` |
| `requests` WHERE type='car' | создаём `pass` + `vehicle` | `pass_type='vehicle'`, FK на новый `vehicles.id` |
| `qr_passes(request_id, token, ...)` | `qr_passes(pass_id, token, render_version)` | `pass_id` — id созданного выше passa; `invalidated_at` → `status='revoked'` на passe |
| `qr_passes.used_at/used_by_uid` | visit_log с `event_type='entry_allowed'` + pass.status='used' (для one-shot) | |

Миграция идёт в Фазе 7 (перед go-live), не раньше — legacy продолжает работать до этого момента.

---

## 6. Acceptance criteria

- [ ] Миграция `011_passes.sql` применяется с нуля и на копии текущей property-DB без ошибок
- [ ] Все 8 API-эндпоинтов покрыты unit + integration тестами (happy path + 4 основные error-кейса)
- [ ] State-машина enforce'ится в service-слое (нельзя issue_qr на `expired`, revoke `revoked` и т.д.)
- [ ] `visit_logs.pass_id` FK работает; guard-scan создаёт корректный event
- [ ] Audit-trail: каждая mutation → запись в `property_audit_log`
- [ ] Фронт guard-console (Фаза 4) работает с `passes`, не с `requests`

---

## 7. Открытые вопросы

1. **Re-issue QR:** если резидент потерял экран с QR — генерим новый token (новая строка в `qr_passes` с инкрементом `render_version`) или правим существующую? → **Решено:** обновляем row, инкремент `render_version`. Старый token становится невалидным сразу.
2. **Multi-pass на одну заявку:** нужен ли сейчас или откладываем? → **Решено:** nullable `access_request_id` + FK без UNIQUE — multi-pass поддержан schemaтически, UX в v1 выдаёт только 1 пасс на заявку (enforce в сервисе, не в БД).
3. **`zone_id/point_id/policy_id`** — в Фазе 3 оставляем всегда NULL. Активируем, когда появится первый СКУД-интегратор (пост-релиз).

---

## 8. Формат спек-файла (meta)

Этот документ — **шаблон** для остальных module-specs в `platform-v1/`. Минимальный набор разделов:
1. Назначение (зачем сущность, почему отдельная)
2. Схема (короткая форма + ссылка на мастер-спеку)
3. State machine (если применимо)
4. API (таблица endpoint × роль × назначение)
5. Миграция из legacy (правила mapping)
6. Acceptance criteria (чек-лист для closure)
7. Открытые вопросы + решения

Объём: 1–2 страницы. Если спеке нужно больше — дробим на под-модули.
