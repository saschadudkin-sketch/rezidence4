# Module Spec — `announcements_v2` (platform-v1)

**Фаза:** 5 (Content + Notifications)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.8
**Миграция:** `backend/src/v1/migrations/020_announcements_v2.js`
**Существующий код:** `backend/src/routes/announcements.js` + legacy table `announcements` (`dbMigrations.js` lines 360–371)
**Связано:** `notifications-outbox-spec.md` (fan-out при публикации), `documents-v2-spec.md` (link-to-document в body)

---

## 1. Назначение

`announcements_v2` — объявления УК резидентам объекта: срочные (отключение воды сегодня 14:00–18:00), плановые (собрание собственников в субботу), маркетинговые (открылся новый кафе в соседнем корпусе). Ключевое отличие от `documents_v2` — **time-bound broadcast** с явной отправкой уведомлений на момент публикации.

**Legacy-модель (`announcements`) проблемы:**
- Нет `property_id` → single-tenant
- `type VARCHAR(20)` CHECK (`info/urgent/maintenance`) + `pinned BOOLEAN` — два сигнала «важности», путаются
- Нет `starts_at` → нельзя написать «отключение с 14:00 завтра» и показать только начиная с завтра
- Нет audience-targeting (всё broadcast всем residents объекта)
- Нет связки с notifications — отправка уведомлений инлайн в роуте через `notificationService.sendTo(...)`, fire-and-forget
- `author_id TEXT REFERENCES users(uid)` — не работает после split

**v2-модель (из мастер-спеки §5.8):**
- `property_id` явно
- `is_urgent BOOLEAN` — один флаг вместо type-enum (маркетинговые/плановые/срочные определяются по тональности, не по DB-enum — избегаем burnout на ключевых категориях)
- `starts_at`/`expires_at` — временное окно видимости
- `created_by_staff_id UUID → staff_users`
- **Audience-targeting** (добавлен поверх мастер-спеки): кому рассылать — всем resident'ам объекта, по зданию, по подъезду, по типу unit (owner/tenant). Без этого feature становится «громкой кнопкой», и УК будет боязливо им пользоваться.

---

## 2. Схема

### 2.1 `announcements_v2`

```
announcements_v2
  id                   UUID PK
  property_id          UUID NOT NULL
  title                TEXT NOT NULL
  body_md              TEXT NOT NULL
                          (Markdown, рендерится через тот же sanitizer, что documents_v2)
  is_urgent            BOOLEAN NOT NULL DEFAULT false
                          (визуально: красный badge + показывается сверху списка)
  category             ENUM(general/maintenance/event/emergency/marketing) NOT NULL DEFAULT 'general'
                          (для UI-фильтра резидента + метрик УК; НЕ дублирует is_urgent)
  audience_type        ENUM(all/building/entrance/unit_type/custom) NOT NULL DEFAULT 'all'
                          (см. §2.2 для 'custom')
  audience_building_id UUID NULL → buildings
                          (NOT NULL iff audience_type='building')
  audience_entrance_id UUID NULL → entrances
                          (NOT NULL iff audience_type='entrance')
  audience_unit_type   ENUM(owner/tenant/family_member) NULL
                          (NOT NULL iff audience_type='unit_type' — фильтр по residents.resident_type)
  starts_at            TIMESTAMPTZ NOT NULL DEFAULT now()
                          (NULL не допускается — если «сразу», то = now() при создании)
  expires_at           TIMESTAMPTZ NULL
                          (NULL = без срока; bounded-ness проверяется в UI не в БД)
  is_pinned            BOOLEAN NOT NULL DEFAULT false
                          (для УК — «прикрепить» объявление наверху списка, не зависит от is_urgent)
  notify_channels      TEXT[] NOT NULL DEFAULT ARRAY['web_push']
                          (какие каналы использовать для fan-out;
                           subset of {web_push, sms, telegram, email};
                           sms и email требуют явного флажка — дорого и инвазивно)
  published_at         TIMESTAMPTZ NULL
                          (NULL = draft; NOT NULL = опубликовано и fan-out запущен)
  created_by_staff_id  UUID NULL → staff_users
  published_by_staff_id UUID NULL → staff_users
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  deleted_at           TIMESTAMPTZ NULL
```

Индексы:
- `(property_id, is_pinned DESC, is_urgent DESC, starts_at DESC) WHERE deleted_at IS NULL AND published_at IS NOT NULL` — основной list для резидента
- `(property_id, category, starts_at DESC) WHERE deleted_at IS NULL` — фильтр по категории
- `(property_id, published_at DESC) WHERE published_at IS NOT NULL` — админ-view
- `(property_id, audience_building_id) WHERE audience_building_id IS NOT NULL`
- `(property_id, audience_entrance_id) WHERE audience_entrance_id IS NOT NULL`

**Инварианты:**
- `expires_at IS NULL OR expires_at > starts_at`
- `audience_type` соответствует заполненному полю: ровно одно из `audience_building_id`/`audience_entrance_id`/`audience_unit_type` NOT NULL для типов `building`/`entrance`/`unit_type`; для `all` и `custom` — все NULL
- `published_at IS NOT NULL ⇒ published_by_staff_id IS NOT NULL`
- `is_urgent=true AND notify_channels NOT @> ARRAY['web_push']` — **запрещено** (срочное обязано идти push'ем; sms дополнительно)
- `deleted_at IS NULL OR deleted_at ≥ created_at`
- `notify_channels ⊆ {'web_push','sms','telegram','email'}` (CHECK constraint)

### 2.2 `announcement_targets` (для `audience_type='custom'`)

Опциональная таблица — только если feature «выбрать конкретных резидентов из списка» понадобится в v1.

```
announcement_targets
  announcement_id  UUID NOT NULL → announcements_v2
  resident_id      UUID NOT NULL → residents
  PRIMARY KEY (announcement_id, resident_id)
```

**Резолюция:** в v1 **не делаем**. Custom audience — post-launch feature. Флаг `audience_type='custom'` пока не используется (CHECK constraint ограничивает 4 значения до момента появления таблицы). Это решение — §7 Q3.

---

## 3. State machine

```
┌───────┐  POST /announcements           ┌───────────┐
│ draft │ ─────────────────────────────▶ │ scheduled │ (published_at IS NOT NULL AND starts_at > now())
└───┬───┘                                └─────┬─────┘
    │                                          │ cron tick
    │ POST /announcements/:id/publish          ▼
    │  (published_at = now()                 ┌─────────┐
    │   starts_at ≤ now())                   │  active │
    └─────────────────────────────────────▶  └────┬────┘
                                                  │ expires_at < now()
                                                  ▼
                                             ┌─────────┐
                                             │ expired │ (terminal; остаётся в архиве)
                                             └─────────┘

Отдельные ветки:
 - любое состояние → deleted (soft) через DELETE
 - draft → draft через PATCH
 - scheduled/active → unpublished (published_at := NULL) только для property_admin
```

**Ключевое отличие от documents:**

`announcements_v2` — событийный. **Публикация триггерит fan-out** уведомлений. После публикации уведомления уже ушли в outbox — откатить нельзя. `unpublish` убирает с UI, но ранее отправленные push/sms остаются доставленными.

---

## 4. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/announcements?category=&only_active=true&since=&until=` | `resident` | Видимые объявления резиденту (filtered by audience + `starts_at ≤ now() ≤ expires_at`) |
| `GET` | `/api/v1/announcements/:id` | `resident`, `staff` | Детали |
| `GET` | `/api/v1/admin/announcements?status=draft\|scheduled\|active\|expired\|deleted` | `staff` | Админ-view |
| `GET` | `/api/v1/public/:property_slug/announcements` | — (без auth) | Publicly-visible: `audience_type='all' AND category IN ('emergency','maintenance') AND published_at IS NOT NULL AND (expires_at IS NULL OR expires_at > now())` — ограничено для kiosk/info-табло |
| `POST` | `/api/v1/announcements` | `property_admin`, `concierge` | Создание; `published_at` опционально (без — draft) |
| `PATCH` | `/api/v1/announcements/:id` | `property_admin`, `concierge` (только до публикации) | Правки; после публикации — **не меняется** (для этого отдельный endpoint `publish-amendment`) |
| `POST` | `/api/v1/announcements/:id/publish` | `property_admin`, `concierge` (для не-`is_urgent`), `property_admin` (для `is_urgent`) | Публикация; ставит `published_at=now()`; триггерит fan-out |
| `POST` | `/api/v1/announcements/:id/unpublish` | `property_admin` | `published_at = NULL` (остаётся draft); **не** отзывает уже отправленные уведомления |
| `POST` | `/api/v1/announcements/:id/publish-amendment` | `property_admin` | Публикация исправленной версии (создаёт новый announcement с `is_amendment_of = original_id`; оригинал получает `superseded_at=now()`) — см. §7 Q4 |
| `DELETE` | `/api/v1/announcements/:id` | `property_admin` | Soft delete |
| `GET` | `/api/v1/admin/announcements/:id/metrics` | `property_admin` | Reach-метрики: сколько residents попало в audience, сколько уведомлений отправлено/доставлено/открыто (join с `notification_log_v2`) |

**Capability matrix:**

| Operation | security | concierge | property_admin |
|---|---|---|---|
| GET /announcements | ✅ | ✅ | ✅ |
| POST /announcements (draft) | ❌ | ✅ | ✅ |
| POST /announcements (+ publish) | ❌ | ✅ (non-urgent) | ✅ |
| POST publish (is_urgent=true) | ❌ | ❌ | ✅ only |
| PATCH (draft only) | ❌ | ✅ | ✅ |
| publish-amendment | ❌ | ❌ | ✅ |
| DELETE | ❌ | ❌ | ✅ |

Причина гейта на `is_urgent`: урегентное объявление → push+sms всем → платный канал sms → последствия ошибки велики. Только `property_admin` берёт эту ответственность.

**Rate-limits:**
- POST /announcements: 10/hour per-staff (предотвращаем flood)
- POST /publish: 5/hour per-property для `is_urgent=true` (отдельный контур)

---

## 5. Fan-out уведомлений

### 5.1 Алгоритм

При успешном `POST /:id/publish` (или cron-tick переводящем `scheduled → active` при пересечении `starts_at`):

```
BEGIN;
  -- 1. Обновить announcement
  UPDATE announcements_v2 SET published_at=now(), published_by_staff_id=... WHERE id=$1;

  -- 2. Резолвить audience в список recipient_ids
  SELECT id FROM residents
  WHERE property_id = $prop
    AND is_active = true
    AND (
      -- all
      $audience_type = 'all'
      OR
      -- building: все residents unit'ов этого building
      ($audience_type = 'building' AND unit_id IN
        (SELECT id FROM units WHERE building_id = $building_id))
      OR
      -- entrance
      ($audience_type = 'entrance' AND unit_id IN
        (SELECT id FROM units WHERE entrance_id = $entrance_id))
      OR
      -- unit_type
      ($audience_type = 'unit_type' AND resident_type = $unit_type)
    );

  -- 3. Для каждого recipient × каждый channel — enqueueNotification
  FOR each recipient IN recipients:
    FOR each channel IN notify_channels:
      enqueueNotification(tx, {
        propertyId: $prop,
        eventType: 'announcement.published',
        channel,
        recipientType: 'resident',
        recipientId: recipient.id,
        recipientAddress: resolve_address(recipient, channel),  -- phone / push_subscription / telegram_chat_id
        payload: {
          announcement_id: $id,
          title, body_preview: body_md[0:200],
          is_urgent, category,
          deep_link: `/announcements/${id}`
        },
        correlationId: $announcement_id
      });

COMMIT;
-- outbox worker подхватит все rows и fan-out'ит по каналам
```

**Важно:** fan-out — **в одной транзакции** с UPDATE announcements. Если транзакция падает — не публикуется и ничего не отправляется.

### 5.2 Объём

Для Замоскворечья (реалистичный baseline): ~500 residents × 2 channels (push+sms для urgent) = 1000 rows в outbox на одно urgent-объявление. Outbox worker (см. outbox-спеку) обрабатывает асинхронно; при 1 req/sec per-channel-adapter это ~17 минут на полный fan-out. Acceptable для МВП; при росте — конкурентный worker (см. outbox §7 Q3).

### 5.3 Идемпотентность

Double-click на «опубликовать» — защита на уровне service:
- Проверка `published_at IS NULL` перед UPDATE
- Если `published_at IS NOT NULL` → 409 с сообщением «уже опубликовано»
- Нет re-publish того же id — только `publish-amendment` с новым ID

---

## 6. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `announcements.title`, `body` | `title`, `body_md` | 1-to-1 (как в documents — принимаем как markdown) |
| `announcements.type='info'` | `category='general'`, `is_urgent=false` | |
| `announcements.type='urgent'` | `category='emergency'`, `is_urgent=true` | |
| `announcements.type='maintenance'` | `category='maintenance'`, `is_urgent=false` | |
| `announcements.pinned=true` | `is_pinned=true` | 1-to-1 |
| `announcements.published_at` | `published_at` (same) + `starts_at = published_at` | Легаси не имел starts_at — синхронизируем с published_at |
| `announcements.expires_at` | `expires_at` | 1-to-1 |
| `announcements.author_id → users(uid)` | `created_by_staff_id + published_by_staff_id UUID → staff_users` | Резолв uid → staff_users.external_uid; если не найден — NULL |
| (отсутствует) | `audience_type='all'` | Легаси не имел targeting; вся история — broadcast |
| (отсутствует) | `notify_channels=['web_push']` | Default; легаси-отправки уже ушли — не пере-отправляем |

**Fan-out при миграции: НЕТ.** Уже опубликованные легаси-объявления копируются в `announcements_v2`, но уведомления не отправляются повторно (они уже были доставлены через `notificationService`, факт в legacy `notification_log`).

После миграции legacy `announcements` делается read-only (переименовывается в `_legacy_announcements`).

---

## 7. Acceptance criteria

- [ ] Миграция создаёт `announcements_v2` с 5 индексами из §2.1
- [ ] Все 6 инвариантов из §2.1 enforced (CHECK + service)
- [ ] State machine §3 enforced; попытка PATCH после публикации → 409
- [ ] `/api/v1/announcements` возвращает резиденту только те, что попадают в его audience (unit/building/entrance/unit_type) + time-window
- [ ] `POST /:id/publish` для `is_urgent=true` требует роль `property_admin` — `concierge` получает 403
- [ ] Fan-out происходит в одной транзакции с UPDATE; тест: transaction rollback → 0 outbox rows, 0 published_at updated
- [ ] Idempotency: double-publish → 409; только один fan-out в outbox
- [ ] Cron tick `scheduled → active` корректно публикует at `starts_at` (unit-тест с мок-временем)
- [ ] `notify_channels` валидируется: unsupported channel → 400
- [ ] Audit-запись на: create, publish, unpublish, amendment, delete
- [ ] `/api/v1/public/:property_slug/announcements` доступен без auth, только emergency/maintenance category
- [ ] Rate-limit 10/hour POST + 5/hour publish для is_urgent — enforced
- [ ] Метрики в `/admin/announcements/:id/metrics` — join с `notification_log_v2` по `correlation_id=announcement.id`
- [ ] Интеграционный тест e2e: create → publish → outbox rows → notification_log_v2 rows — counts совпадают с audience size × channels
- [ ] Markdown sanitizer переиспользуется из documents_v2 (shared module)

---

## 8. Open questions (резолюции)

**Q1. Почему `is_urgent BOOLEAN` + `category ENUM`, а не один enum с уровнем важности?**
A: Ортогональные измерения. `is_urgent` = «push прямо сейчас, даже ночью (только push обхода DnD)». `category` = «тематика для фильтра/группировки». Урегентное маркетинговое сообщение — невалидное сочетание и DB-инвариантом не ловится, но бизнес-правило в service может (в v1 — не ловим, доверяем УК).

**Q2. Ночные push'и?**
A: Решение — не на уровне спеки, на уровне channel-adapter'а и resident-preferences (`residents.notification_quiet_hours` — добавить в Phase 5 миграцией). Спека announcements триггерит отправку, adapter решает когда доставить. `is_urgent=true` обходит quiet hours (по умолчанию в adapter).

**Q3. Нужна ли таблица `announcement_targets` в v1?**
A: Нет. Custom audience — post-launch feature; `audience_type='custom'` зарезервирован в enum, но не используется. Если УК просит — добавим миграцией (enum + таблица). Для МВП 4-х типов (all/building/entrance/unit_type) достаточно.

**Q4. Как исправить опубликованное объявление?**
A: Через `publish-amendment`: создаётся **новое** объявление с ссылкой на оригинал (`is_amendment_of UUID NULL → announcements_v2` — добавить в схему как 2nd migration при необходимости; в v1 — отложено). В UI — «Исправлено: [ссылка на актуальную версию]». Оригинал получает `superseded_at`. Fan-out нового включает тех же recipients + префикс «Исправление».
  **Резолюция для v1:** `publish-amendment` endpoint — **не реализуем**. PATCH после публикации запрещён, исправления — только через создание нового объявления с ручной ссылкой в теле. `is_amendment_of` — post-launch enhancement.

**Q5. Что с уведомлениями, если announcement отложенный (scheduled) и его удалили до starts_at?**
A: DELETE (soft) проверяет `published_at IS NULL OR starts_at > now()`. Если уже опубликован и scheduled — отменяет cron-tick (флаг `deleted_at`). Outbox-запись генерируется только в момент «scheduled → active», так что соответствующих rows ещё нет.

**Q6. Push vs SMS vs Telegram — как резидент выбирает?**
A: `residents` имеет флаги (см. Phase 2 spec): `web_push_enabled`, `sms_enabled`, `telegram_enabled` (+ `telegram_chat_id`). Announcement говорит «какие каналы использовать» через `notify_channels`, но фактически для каждого резидента adapter проверяет его персональные preferences. Intersection: `announcement.notify_channels ∩ resident.enabled_channels`.

**Q7. Что если audience пустая?**
A: Warning в UI при create («audience резолвится в 0 резидентов — продолжить?»). Если подтвердили — публикуется, 0 outbox rows. В audit пишется. Это валидный edge case (например, «всем tenant'ам на Свободе 8» — а tenants'ов там нет).

**Q8. Почему `notify_channels TEXT[]` а не bitmask / отдельные bool-флаги?**
A: Postgres ARRAY с CHECK — читаемее + расширяемо. Bitmask — enterprise-артефакт без реальной выгоды. Отдельные bool'ы плохо масштабируются (email → add column → миграция). `ARRAY[]::text[]` — идиоматично для Postgres.

**Q9. Как долго хранить expired announcements?**
A: Навсегда, soft-deleted — 365 дней retention (как documents). Expired — навсегда в архиве для аудита и истории «что УК сообщала резидентам».

---

## 9. Приложение — UX-сценарии

### 9.1 Срочное (отключение воды)

1. `property_admin` открывает «Новое объявление»
2. Выбирает `category=emergency`, `is_urgent=true`, `notify_channels=[push, sms]`
3. `audience_type=building`, выбирает корпус
4. Пишет title «Отключение воды», body_md «Сегодня с 14:00 до 18:00, горячая вода…»
5. `expires_at = сегодня 23:59`
6. Publish → fan-out на 180 residents этого корпуса × 2 канала = 360 outbox rows
7. Через 2 минуты 95% получают push, sms идёт 10-15 минут (Twilio rate)

### 9.2 Плановое (собрание собственников)

1. `concierge` создаёт `category=event`, `is_urgent=false`, `notify_channels=[push]`
2. `audience_type=unit_type`, `audience_unit_type=owner`
3. `starts_at = через 3 дня 09:00` (отложенное)
4. `expires_at = дата собрания + 1 день`
5. Publish → announcement уходит в `scheduled`
6. Cron tick на `starts_at` переводит в `active` + fan-out на owners объекта (~ 200 из 500 residents) × 1 канал = 200 outbox rows

### 9.3 Маркетинговое (открытие кафе)

1. `concierge`, `category=marketing`, `is_urgent=false`, `notify_channels=[push]`
2. `audience_type=all`
3. Publish → 500 outbox rows

---

## 10. Будущие расширения (не в scope Phase 5)

- `is_amendment_of` FK (§7 Q4) — при первом реальном запросе от УК
- `announcement_targets` custom-audience (§7 Q3) — если понадобится «только этим 10 резидентам»
- Read-receipts: трекать когда резидент открыл объявление. Требует таблицу `announcement_reads(announcement_id, resident_id, read_at)`. Post-launch.
- A/B headlines для маркетинга. Очевидно не в scope.
- Email-digest «объявления за неделю» — альтернатива SMS для экономии. BACKLOG.
