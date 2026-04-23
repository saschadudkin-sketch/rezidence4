# Module Spec — `visit_logs` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.6
**Миграция:** `backend/src/v1/migrations/013_visit_logs_v2.sql`

---

## 1. Назначение

`visit_logs` — append-only журнал событий прохода/проезда. Каждая попытка — одна строка: scan QR, manual admit на посту, запись от СКУД по вебхуку, импорт из провайдера. Это **единственный источник правды** по фактическим визитам в property.

В legacy-коде журнала событий **нет** — есть только поле `qr_passes.used_at + used_by_uid`, которое фиксирует **первый успешный скан** и ничего больше:
- Нельзя узнать, сколько раз гость пытался войти и получил deny
- Нельзя отличить «прошёл через турникет» от «охранник открыл руками»
- Нельзя связать событие со СКУД-вебхуком (поля `provider_event_id` не существует)
- Нельзя построить reports «кто, куда, когда» по авто/резиденту/зоне

**В platform-v1 мы делаем:**
- `visit_logs` — first-class append-only таблица, каждый event = row
- `qr_passes.used_at/used_by_uid` остаются в legacy-таблице только для read-compat; новый код туда не пишет
- Guard-console (Фаза 4) и любой будущий отчёт читают только из `visit_logs`

---

## 2. Схема

```
visit_logs
  id                          UUID PK
  property_id                 UUID NOT NULL
  pass_id                     UUID NULL    → passes
  access_point_id             UUID NULL    → access_points  (всегда NULL в v1, активируется пост-релиз)
  event_type                  ENUM(entry_allowed/entry_denied/exit_allowed/exit_denied/
                                   manual_admit/manual_deny/override) NOT NULL
  event_source                ENUM(domhub/skud/guard_console/import) NOT NULL
  person_label                TEXT NULL     (ФИО/описание на момент события — immutable snapshot)
  vehicle_plate               TEXT NULL     (нормализованный госномер — для поиска когда pass_id NULL)
  performed_by_staff_id       UUID NULL     (кто на посту — для manual/guard_console)
  provider_event_id           TEXT NULL     (id вебхука СКУД — для идемпотентности)
  provider_payload            JSONB NULL    (сырой payload провайдера — для форензики)
  occurred_at                 TIMESTAMPTZ NOT NULL   (время события, не время записи)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Индексы: `(property_id, occurred_at DESC)`, `(pass_id)`, `(access_point_id)`, `(vehicle_plate)`, `(provider_event_id)`.

Доп. ограничение: `UNIQUE (event_source, provider_event_id) WHERE provider_event_id IS NOT NULL` — защита от дубля при ретрае вебхука.

---

## 3. State machine

Нет. `visit_logs` — append-only: запись создаётся один раз и не меняется. Любое «исправление» — новая строка с `event_type='override'` + FK в `access_overrides`.

Жёсткое правило на уровне сервиса: `UPDATE` и `DELETE` по `visit_logs` запрещены (только `INSERT`). Проверяется unit-тестом на сервис-слое и отсутствием соответствующих методов в route.

---

## 4. API

Все роуты под `/api/v1/visits`, tenant-resolved через hostname middleware.

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/visits` | `security`, internal services | Записать событие (обычно вызывается из `passes.verify`, `skud-webhook`, `guard-console`) |
| `GET` | `/api/v1/visits?pass_id=&vehicle_plate=&event_type=&from=&to=&access_point_id=` | `security`, `concierge`, `property_admin` | Список событий с фильтрами, сортировка `occurred_at DESC` |
| `GET` | `/api/v1/visits/:id` | `security`, `property_admin` | Детали события + связанный pass + linked incident (если есть) |
| `GET` | `/api/v1/visits/by-pass/:pass_id` | owner + staff | История сканов конкретного пропуска |
| `GET` | `/api/v1/visits/by-plate/:plate` | `security`, `property_admin` | История по нормализованному госномеру (включая события без pass_id — freehand admit) |

Не экспонируем `PATCH`/`PUT`/`DELETE`. Корректировка — только через `access_overrides` (см. `access-incidents-spec.md`).

Все `POST` пишут в `property_audit_log` с `entity_type='visit_log'`, `entity_id=visit_logs.id`.

---

## 5. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `qr_passes(request_id, token, used_at, used_by_uid)` WHERE `used_at IS NOT NULL` | `visit_logs(pass_id=…, event_type='entry_allowed', event_source='domhub', occurred_at=used_at, performed_by_staff_id=used_by_uid)` | Одна запись на каждый `used_at` |
| `qr_passes` WHERE `used_at IS NULL AND invalidated_at IS NOT NULL` | ничего | Пропуск отозван до использования — в `visit_logs` нет event; это отражено на `passes.status='revoked'` |
| `request_history(req_id, label)` WHERE `label='visitor_arrived'` (если такая строка существует в истории) | `visit_logs(pass_id=…, event_type='manual_admit', event_source='guard_console', occurred_at=at, performed_by_staff_id=resolved(by_name))` | Best-effort: если legacy-история нечёткая, помечаем `event_source='import'` и сохраняем сырую строку в `provider_payload` |
| blacklist deny attempts (**отсутствуют в legacy**) | ничего | Новая аналитика — начинается с v1 |

Миграция в Фазе 7 (перед go-live). До этого legacy `qr_passes.used_at` продолжает работать для legacy-фронта.

**Важно:** legacy-пропуск — one-shot. При миграции на каждый `used_at` создаётся ровно одна запись `entry_allowed`. Исторические `exit_*` события восстановить нельзя — их не было.

---

## 6. Acceptance criteria

- [ ] Миграция `013_visit_logs_v2.sql` применяется с нуля и на копии текущей property-DB без ошибок
- [ ] `INSERT` идемпотентен по `(event_source, provider_event_id)` — повторный вебхук СКУД возвращает существующую строку, не дубль
- [ ] Сервис-слой отклоняет `UPDATE`/`DELETE` (нет соответствующих методов, unit-тест запрещает)
- [ ] Guard-scan flow (`passes.verify`) всегда завершается `INSERT INTO visit_logs`, даже при `deny` (event_type зависит от verdict)
- [ ] `GET /visits?pass_id=&from=&to=` покрыт integration-тестом на паре (allowed + denied) в одном окне
- [ ] `GET /visits/by-plate/:plate` работает и по pass-free событиям (manual admit freehand, без привязки к `passes`)
- [ ] Запись события автоматически создаёт `access_incident` если `event_type IN (entry_denied, manual_deny)` — см. `access-incidents-spec.md §3`

---

## 7. Открытые вопросы

1. **Корреляция `provider_event_id` между источниками.** Если СКУД и guard-console одновременно фиксируют одного визитёра — две строки или одна? → **Решено:** две строки. `provider_event_id` уникален в пределах `event_source`, не глобально. Дедупликация на уровне отчётов (по `occurred_at ± 5s + pass_id`), не на уровне хранения.
2. **Retention политика.** Сколько держим `provider_payload` JSONB (может быть тяжёлый у СКУД)? → **Решено:** v1 без retention, держим всё. Если размер начнёт тянуть БД — Фаза пост-релиз: `payload_archived_to_s3=true` + очистка JSONB.
3. **Out-of-order events.** СКУД может прислать событие с `occurred_at` в прошлом (retry после выключения). → **Решено:** принимаем любой `occurred_at`, индекс по `occurred_at DESC` возвращает корректный порядок. Нет защиты «не писать события старше 24h» — это потеря данных.
4. **`person_label` vs резидент.** Зачем TEXT, если есть `passes.subject_resident_id`? → **Immutable snapshot**. Если резидент сменит ФИО или уволится — исторический event должен показывать ФИО на момент события. Не нормализуем.
5. **`access_point_id` NULL во всей v1.** Подтверждено: активируется только после появления первого СКУД-интегратора. Гварды в v1 не привязаны к access_points — у них роль `security` и один property.
