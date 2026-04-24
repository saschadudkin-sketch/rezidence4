# Module Spec — `access_incidents` + `access_overrides` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.6
**Миграция:** `backend/src/v1/migrations/014_access_incidents.sql` + `015_access_overrides.sql`

---

## 1. Назначение

**`access_incidents`** — каждый случай, когда что-то в access-потоке пошло не по happy-path: скан истёкшего QR, попытка въезда авто из blacklist, manual deny на посту, конфликт от СКУД-провайдера. Это **управляемая очередь задач** для службы безопасности и property_admin, а не пассивный лог.

**`access_overrides`** — решение staff в обход автоматической политики: пропустить руками, запретить руками, временно внести в whitelist/blacklist. Привязаны к incident (если возникли из него) или к pass (напрямую, без incident — пример: временный блок подозрительного пасса).

**Почему обе таблицы в одной спеке:**
- Жизненный цикл связан: большинство override создаются как реакция на incident
- Миграция идёт в одном PR (`014` + `015`), оба FK на `passes`/`visit_logs` появляются одновременно
- API-операции guard-console часто trigger'ят оба: `resolve incident` + `create override` в одной транзакции

В legacy-коде **ни одной из этих сущностей нет**. Все deny-попытки и manual-решения теряются — максимум остаётся в `request_history` как свободный текст.

---

## 2. Схема

```
access_incidents
  id                      UUID PK
  property_id             UUID NOT NULL
  related_pass_id         UUID NULL   → passes
  related_visit_log_id    UUID NULL   → visit_logs      (event, который породил incident)
  related_vehicle_id      UUID NULL   → vehicles
  incident_type           ENUM(expired_pass_attempt/invalid_qr/blacklist_hit/
                               outside_time_window/unauthorized_vehicle/manual_override/
                               provider_conflict/suspicious_repeat_attempt) NOT NULL
  severity                ENUM(low/medium/high/critical) DEFAULT 'medium'
  status                  ENUM(open/investigating/resolved/dismissed) DEFAULT 'open'
  title                   TEXT NOT NULL
  description             TEXT NULL
  created_by_staff_id     UUID NULL       (NULL = system-created из verify-flow)
  assigned_to_staff_id    UUID NULL
  resolved_at             TIMESTAMPTZ NULL
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()

access_overrides
  id                      UUID PK
  property_id             UUID NOT NULL
  incident_id             UUID NULL   → access_incidents
  pass_id                 UUID NULL   → passes
  performed_by_staff_id   UUID NOT NULL
  override_type           ENUM(manual_admit/manual_deny/temporary_whitelist/temporary_block) NOT NULL
  reason                  TEXT NOT NULL     (human-readable, обязательно)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Индексы:
- `access_incidents(property_id, status)` — guard-console dashboard
- `access_incidents(incident_type)`, `(assigned_to_staff_id)`
- `access_overrides(incident_id)`, `(pass_id)`, `(performed_by_staff_id, created_at DESC)`

Ограничения:
- `access_incidents`: CHECK: если `status IN ('resolved','dismissed')` → `resolved_at IS NOT NULL`
- `access_overrides`: CHECK: хотя бы одно из `incident_id`, `pass_id` должно быть NOT NULL (override должен к чему-то относиться)

---

## 3. State machine

### Incident lifecycle

```
   (system или staff создаёт)
         │
         ▼
       open
         │ staff.assign_to(me) или staff.start_investigation
         ▼
    investigating
         │         
         ├─ staff.resolve(reason) ──► resolved
         │
         └─ staff.dismiss(reason) ──► dismissed   (ложная тревога)

   open ── staff.dismiss ──► dismissed  (явно ложная, без investigation)
   open ── staff.resolve ──► resolved   (быстрый фикс, например manual_admit)
```

Правила:
- `open → resolved` разрешён без фазы `investigating` (guard сразу обработал)
- `resolved/dismissed` — terminal states, никакого `reopen`. Если проблема вернулась — новый incident с FK в `description`
- Переход в `resolved` **часто** сопровождается созданием `access_override` (но не всегда — incident может быть просто запротоколирован)

### Auto-creation rules (из `passes.verify`, см. qr-verification-spec)

| event_type | дополнительное условие | incident_type | severity |
|---|---|---|---|
| `entry_denied` | token not found in qr_passes | `invalid_qr` | medium |
| `entry_denied` | pass.status='expired' | `expired_pass_attempt` | low |
| `entry_denied` | pass.status='revoked' OR 'blocked' | `blacklist_hit` (логич.) или `expired_pass_attempt` (если истёк) | high |
| `entry_denied` | vehicle found в blacklist | `blacklist_hit` | high |
| `entry_denied` | now < valid_from OR now > valid_until | `outside_time_window` | low |
| `entry_denied` | SKUD rejected, но pass.status='active' | `provider_conflict` | high |
| `manual_admit` | вручную при active deny причине | `manual_override` | low |
| ≥3 `entry_denied` за 10 мин по одному token/plate | — | `suspicious_repeat_attempt` | high |

Severity: `critical` оставляем только для руч. выставления (например, подделка QR, физ. угроза) — из авто-правил не проставляется.

### Override — не имеет state, append-only (как `visit_logs`).

---

## 4. API

### Incidents

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/access-incidents` | `security`, internal (verify-flow) | Создать incident (staff вручную или system из verify) |
| `GET` | `/api/v1/access-incidents?status=&severity=&incident_type=&assigned_to_staff_id=` | `security`, `property_admin` | Список с фильтрами (default: status=open,investigating) |
| `GET` | `/api/v1/access-incidents/:id` | `security`, `property_admin` | Детали + related pass/visit/vehicle + список overrides |
| `POST` | `/api/v1/access-incidents/:id/assign` | `security`, `property_admin` | Назначить на staff (`assigned_to_staff_id`) + status='investigating' |
| `POST` | `/api/v1/access-incidents/:id/resolve` | assigned_to or `property_admin` | Закрыть (resolve); body: `{ reason, create_override?: OverrideInput }` |
| `POST` | `/api/v1/access-incidents/:id/dismiss` | assigned_to or `property_admin` | Отметить ложной (dismiss); body: `{ reason }` |
| `PATCH` | `/api/v1/access-incidents/:id` | `security`, `property_admin` | Обновить `severity`, `description`, `title` (НЕ `status` — через dedicated endpoints) |

### Overrides

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/access-overrides` | `security`, `property_admin` | Создать override (обычно через `incidents/:id/resolve` с `create_override`, но возможен standalone для temp-whitelist) |
| `GET` | `/api/v1/access-overrides?pass_id=&incident_id=&performed_by_staff_id=&from=&to=` | `security`, `property_admin` | Аудит-список override'ов |
| `GET` | `/api/v1/access-overrides/:id` | `security`, `property_admin` | Детали |

Нет `PATCH`/`DELETE` для overrides — append-only (как visit_logs).

Все mutations пишут в `property_audit_log`:
- `entity_type='access_incident'` для создания/assign/resolve/dismiss/patch
- `entity_type='access_override'` для создания

---

## 5. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `blacklist` deny hits (**не логируются в legacy**) | ничего | Backfill невозможен; аналитика начинается с v1 |
| `qr_passes.invalidated_at + invalidated_reason` (если столбец существует в истории) | `pass.status='revoked'` на passe | Incident не создаём — revoke был административный, не incident |
| `request_history` WHERE `label='rejected'` с комментарием типа «гость по чёрному списку» | best-effort: один `access_incident(incident_type='blacklist_hit', status='resolved', resolved_at=at)` + `access_override(override_type='manual_deny', reason=comment)` | Only если текст комментария явно указывает на incident — иначе пропускаем. Помечаем `provider_payload` или `description` prefix `[migrated-legacy]` |

Миграция в Фазе 7. До этого момента в property-DB новых property не появляется incidents — только в Замоскворечье после перехода на v1-verify flow.

---

## 6. Acceptance criteria

### Incidents

- [ ] Миграция `014_access_incidents.sql` применяется с нуля и на копии текущей property-DB без ошибок
- [ ] `POST /access-incidents` идемпотентен по `(related_visit_log_id, incident_type)` — повторный вызов из verify-flow не создаёт дубль
- [ ] Auto-creation rules из §3 покрыты integration-тестом: для каждого правила — prepared state + verify call → ассерт incident row
- [ ] Переход `open → resolved` с `create_override` — транзакция: либо оба объекта создаются, либо ни одного
- [ ] `GET /access-incidents?status=open` возвращает отсортированный по `severity DESC, created_at DESC` — для guard dashboard
- [ ] При `severity IN ('high','critical')` создаётся notification для роли `property_admin` (через `notification_log`, Фаза 5 — placeholder сейчас)
- [ ] Попытка `resolve` на already-resolved → `409 Conflict`

### Overrides

- [ ] Миграция `015_access_overrides.sql` применяется
- [ ] CHECK-констрейнт `incident_id OR pass_id` enforce'ится на уровне БД, не только сервиса
- [ ] `POST /access-overrides` без `reason` → `422 Unprocessable Entity`
- [ ] `temporary_whitelist` создаёт `access_override` + записывает `vehicles.flags += ['temp_whitelist']` с TTL (TTL через cron-job, не cron-expression в БД)
- [ ] `temporary_block` аналогично: `pass.status='blocked'` + override row
- [ ] Audit-trail: все overrides видны в `GET /access-overrides?performed_by_staff_id=X` для расследования

---

## 7. Открытые вопросы

1. **Auto-assign incidents.** Стоит ли сразу назначать `incident_type='blacklist_hit'` на дежурного security? → **Решено:** в v1 — нет, чтобы не делать зависимость от `duty_schedule` (его нет). Guard-console показывает `open` incidents как shared-queue; любой security может взять. Auto-assign — пост-релиз.
2. **TTL для temporary_whitelist/temporary_block.** Как enforce'ить «пропускать это авто 2 часа»? → **Решено:** override.reason содержит `ttl_until=<timestamp>` (parsed); batch-job `expireTemporaryOverrides()` каждые 5 мин снимает флаг. В v1 простая реализация; полноценные `access_policies` с временными окнами — пост-релиз.
3. **Incident без `related_*`.** Guard создаёт incident руками без ссылки на pass/visit/vehicle (напр., «подозрительный человек у входа»). → **Разрешено.** Все `related_*` nullable; CHECK только на overrides (`incident_id OR pass_id`), не на incidents.
4. **Severity для `suspicious_repeat_attempt`.** Сейчас `high`. → Вопрос на наблюдение: если окажется шумно (false positives от плохо отсканированных QR) — понизить до `medium` в Фазе 4 после сбора статистики.
5. **Notification в v1 без `notification_log` (Фаза 5).** → **Решено:** сейчас пишем только в лог `logger.info({severity, incident_id}, 'incident.notify.pending')`; канал уведомления появится в Фазе 5. BACKLOG отмечает, что `notification_log` должен дозабрать эти события на backfill.
6. **Override для невалидированных попыток.** Нужно ли разрешать `manual_admit` без существующего incident (guard просто пропустил знакомого)? → **Разрешено.** Override с `incident_id=NULL, pass_id=NULL` допустим? **Нет** — CHECK требует одно из двух. Guard создаёт `access_incident(incident_type='manual_override', status='resolved')` и override с FK на него. Это компромисс: incident-шум, но полный аудит.
