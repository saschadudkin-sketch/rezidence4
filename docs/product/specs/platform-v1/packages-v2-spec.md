# Module Spec — `packages_v2` (platform-v1)

**Фаза:** 5 (Content + Notifications)
**Статус:** Draft
**Схема-база:** мастер-спека `domhub-access-data-model-spec.md` packages не описывает явно — эта спека закрывает пробел. Используем паттерны access-core §5.3 (FK-стиль, property_id, state machine).
**Миграция:** `backend/src/v1/migrations/018_packages_v2.js` (номер уточняется при старте Phase 5)
**Существующий код:** `backend/src/routes/packages.js` + legacy table `packages` (`dbMigrations.js` lines 658–677)

---

## 1. Назначение

`packages_v2` — журнал посылок/доставок, которые консьерж/охрана принимают на ресепшн от имени резидента (резидента нет дома, а курьер уже у двери). Базовый flow:

```
курьер привёз → охрана/консьерж приняла → в журнале "awaiting_pickup"
                                          → уведомление резиденту (SMS + push)
                                          → резидент пришёл за посылкой → "picked_up"
                                          → [если не пришёл 7 дней] напоминание
                                          → [если не пришёл 14 дней] "returned" (уехало обратно)
```

**Legacy-модель (`packages`) проблемы:**
- `recipient_user_id TEXT REFERENCES users(uid) ON DELETE SET NULL` + `recipient_apartment TEXT` — две параллельные попытки адресовать, расходятся. Нет FK на `units`.
- Нет `property_id` → single-tenant
- `notified_at TIMESTAMPTZ` + `reminder_sent_at TIMESTAMPTZ` — встроенная логика уведомлений в main-table, хрупкая. После outbox — эти поля не нужны, факт доставки в `notification_log_v2`.
- `status VARCHAR(20)` CHECK (`awaiting_pickup/picked_up/returned`) — работает, но нет истории переходов
- Нет связи с access (кто конкретно забрал, через какой пропуск)
- `received_by TEXT REFERENCES users(uid)` — не работает после split

**v2-модель:**
- `property_id` явно
- FK `unit_id` вместо `recipient_apartment TEXT` — связь с реальной квартирой
- FK `recipient_resident_id` для явной адресации
- `received_by_staff_id` + `picked_up_by_resident_id` вместо TEXT uid'ов
- State machine формализована (§3)
- Уведомления — через outbox (отдельные rows), поля `notified_at`/`reminder_sent_at` удаляются
- Опционально: связка с access_request при выдаче (если резидент забирает через охрану по QR-пропуску)

---

## 2. Схема

```
packages_v2
  id                       UUID PK
  property_id              UUID NOT NULL
  unit_id                  UUID NOT NULL → units
                             (адресация — основная)
  recipient_resident_id    UUID NULL → residents
                             (явный получатель; NULL если адресовано "на квартиру" без указания человека —
                              тогда любой active resident этой unit может забрать)
  recipient_name_snapshot  TEXT NULL
                             (на коробке написано "Иванов А.А." — снапшот на случай если
                              recipient_resident_id не указан или резидент уехал)
  sender_name              TEXT NULL
  carrier                  VARCHAR(50) NULL
                             (freeform: 'CDEK', 'Почта России', 'Wildberries', 'Yandex.Delivery', 'personal')
  tracking_number          VARCHAR(80) NULL
  photo_url                TEXT NULL
                             (/uploads/ подписанный; фото коробки при приёме — опционально но рекомендуется)
  size_category            ENUM(envelope/small/medium/large/oversize) NULL
                             (для вместимости складского места; envelope = документы, oversize = мебель)
  received_at              TIMESTAMPTZ NOT NULL DEFAULT now()
  received_by_staff_id     UUID NOT NULL → staff_users
  storage_location         VARCHAR(40) NULL
                             (где лежит: 'receptionA-shelf-3', 'storage-room-2'; для быстрого поиска при выдаче)
  status                   ENUM(awaiting_pickup/picked_up/returned/lost) NOT NULL DEFAULT 'awaiting_pickup'
  picked_up_at             TIMESTAMPTZ NULL
  picked_up_by_resident_id UUID NULL → residents
  picked_up_by_name        TEXT NULL
                             (если забрал не резидент — член семьи / курьер / доверенное лицо;
                              имя + документ записываются вручную)
  picked_up_by_staff_id    UUID NOT NULL → staff_users
                             (если status='picked_up' — кто именно выдал; обязательно для аудита)
                             (constraint: NULL iff status != 'picked_up')
  returned_at              TIMESTAMPTZ NULL
  returned_reason          TEXT NULL
  notes                    TEXT NULL
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
```

Индексы:
- `(property_id, status, received_at DESC)` — основной list-запрос «что ждёт выдачи»
- `(property_id, unit_id, status)` — «что на эту квартиру»
- `(property_id, recipient_resident_id, status) WHERE recipient_resident_id IS NOT NULL` — «мои посылки»
- `(property_id, received_at DESC) WHERE status='awaiting_pickup'` partial — горячий SLA-индекс для напоминаний
- `(property_id, tracking_number) WHERE tracking_number IS NOT NULL` — lookup при конфликте «это моя посылка?»

**Инварианты (CHECK + service-level):**
- `status='picked_up'` ⇒ `picked_up_at IS NOT NULL AND picked_up_by_staff_id IS NOT NULL`
- `status='returned'` ⇒ `returned_at IS NOT NULL` (причина желательна, но не обязательна — сломанный товар может возвращаться молча)
- `status='awaiting_pickup'` ⇒ `picked_up_at IS NULL AND returned_at IS NULL`
- `picked_up_by_resident_id IS NOT NULL ⇒ picked_up_by_name IS NULL` (либо резидент, либо имя руками — не оба)
- `picked_up_by_resident_id IS NULL AND status='picked_up' ⇒ picked_up_by_name IS NOT NULL` (если не-резидент забрал — имя обязательно)
- `photo_url` — только `/uploads/` path (CLAUDE.md §Uploads)

---

## 3. State machine

```
                 ┌──────────────────┐
                 │ awaiting_pickup  │ ← (default при POST)
                 └──────┬───────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
   ┌───────────┐  ┌──────────┐  ┌─────────────┐
   │ picked_up │  │ returned │  │   lost      │
   └───────────┘  └──────────┘  └─────────────┘
        terminal     terminal       terminal
```

Переходы:

| From | To | Trigger | Actor |
|---|---|---|---|
| `awaiting_pickup` | `picked_up` | `POST /packages/:id/pickup` | `security`, `concierge` |
| `awaiting_pickup` | `returned` | `POST /packages/:id/return` | `property_admin`, `concierge` |
| `awaiting_pickup` | `lost` | `POST /packages/:id/mark-lost` | `property_admin` (с reason + audit) |
| terminal | — | — | нет переходов обратно; ошибочные статусы → новая запись |

**SLA-автоматика** (отдельный scheduled job, раз в сутки):
- Посылка в `awaiting_pickup` дольше 7 дней → `enqueueNotification` с event_type `package.pickup_reminder`
- Посылка в `awaiting_pickup` дольше 14 дней → создаётся задача consierge («связаться с резидентом, уточнить»); не автоматический return — возврат курьеру требует человеческого решения
- Посылка в `awaiting_pickup` дольше 30 дней → alert property_admin

**Без автоматического перевода в `returned`** — этот переход всегда ручной (кто-то должен физически вынести посылку курьеру).

---

## 4. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/packages?status=&unit_id=&recipient_resident_id=&carrier=&since=&until=` | `security`, `concierge`, `property_admin` | List с фильтрами |
| `GET` | `/api/v1/packages/mine` | `resident` | Свои посылки (active + за 90 дней); `recipient_resident_id = subject.id OR (recipient_resident_id IS NULL AND unit_id IN subject.units)` |
| `GET` | `/api/v1/packages/:id` | `resident` (своя), `staff` | Детали |
| `POST` | `/api/v1/packages` | `security`, `concierge` | Приём посылки; triggers `enqueueNotification` `package.received` → резиденту |
| `PATCH` | `/api/v1/packages/:id` | `concierge`, `property_admin` | Правки метаданных (carrier, notes, storage_location, photo); **не** меняет status |
| `POST` | `/api/v1/packages/:id/pickup` | `security`, `concierge` | Выдача; body: `{ picked_up_by_resident_id? OR picked_up_by_name, document_ref? }` |
| `POST` | `/api/v1/packages/:id/return` | `concierge`, `property_admin` | Возврат курьеру; body: `{ reason }` |
| `POST` | `/api/v1/packages/:id/mark-lost` | `property_admin` | Отметка потери; body: `{ reason }`; требует двойное подтверждение (явный флаг `confirm: true`) |
| `POST` | `/api/v1/packages/:id/remind` | `concierge`, `property_admin` | Ручное напоминание (дополнительно к SLA-автоматике) — enqueue notification |
| `GET` | `/api/v1/packages/metrics?period=` | `property_admin` | Агрегаты: open count, avg pickup-time, % returned, top carriers |

**Capabilities:**
- `resident` видит только свои
- `security` — принимает (POST) и выдаёт (pickup), но не может `return`/`mark-lost`
- `concierge` — всё кроме `mark-lost`
- `property_admin` — все операции, включая `mark-lost`

**Rate-limit:**
- POST /packages: 30 req/min per staff user (защита от спама; нормальная нагрузка 2-5 посылок/час)
- POST /packages/:id/remind: 1 req/hour per package (не спамим резидента)

---

## 5. Связь с другими модулями

### 5.1 Notifications

**Триггеры на `enqueueNotification`:**

| Событие | Event type | Channel | Recipient | Payload |
|---|---|---|---|---|
| POST /packages (новая посылка) | `package.received` | sms + web_push (по настройкам резидента) | `recipient_resident_id` (или все active residents unit если NULL) | `{ sender_name, carrier, tracking_number, photo_url, storage_location }` |
| SLA 7 дней | `package.pickup_reminder` | sms + web_push | same | `{ days_waiting: 7, received_at }` |
| POST /packages/:id/remind | `package.pickup_reminder` (manual) | sms + web_push | same | same + `{ manual: true }` |
| POST /packages/:id/pickup | `package.picked_up_confirmation` | web_push | `picked_up_by_resident_id` | `{ picked_up_at, picked_up_by_name? }` |

Всё через `enqueueNotification(tx, {...})` в той же транзакции, что и UPDATE статуса — см. `notifications-outbox-spec.md §2`.

### 5.2 Access-core (опциональная связка)

Если резидент приходит за посылкой через охрану (охрана сканирует его QR-пропуск резидента), можно залинковать:

```
packages_v2.pickup_visit_log_id UUID NULL → visit_logs_v2
```

(поле опциональное, не в основной схеме — добавлять только если UX-эксперимент подтвердит ценность; пока в BACKLOG как `PKG-1 access-link`)

### 5.3 Audit

Все мутации пишут в `property_audit_log`:
- `package.received` — payload `{ package_id, unit_id, carrier, tracking_number }`
- `package.picked_up` — payload `{ package_id, picked_up_by }`, actor_id = staff
- `package.returned` — payload `{ package_id, reason }`
- `package.marked_lost` — payload `{ package_id, reason, confirmed_by }`, high-severity

---

## 6. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `packages.recipient_user_id TEXT → users(uid)` | `recipient_resident_id UUID → residents` | Резолв `users.uid → residents.external_uid`; если не найден — NULL, `recipient_name_snapshot = users.name_snapshot` |
| `packages.recipient_apartment TEXT` | `unit_id UUID → units` | Резолв `apartment → units.unit_number`; если не найден (тип документа, старый формат) — мигрируется в `notes`, запись создаётся без `unit_id` **только** если миграция ручная (иначе схема требует NOT NULL — см. §7 Q1) |
| `packages.recipient_name TEXT` | `recipient_name_snapshot` | 1-to-1 |
| `packages.sender_name`, `carrier`, `tracking_number`, `photo_url`, `notes` | те же поля | 1-to-1 |
| `packages.received_at` | `received_at` | 1-to-1 |
| `packages.received_by TEXT → users(uid)` | `received_by_staff_id UUID → staff_users` | Резолв `uid → staff_users.external_uid`; если не найден — миграция этой строки **блокируется** (нужен ручной резолв — NOT NULL field) |
| `packages.picked_up_at` | `picked_up_at` | 1-to-1 |
| `packages.picked_up_by_name` | `picked_up_by_name` | 1-to-1 |
| `packages.notified_at`, `reminder_sent_at` | **удаляются** | Факт отправки хранится в `notification_log_v2` (после outbox-cut-over) |
| `packages.status='awaiting_pickup'\|'picked_up'\|'returned'` | `status` (same) + `lost` новый | 1-to-1 + расширение enum |

**Миграционный pre-check:**
- Если в legacy `recipient_apartment` не резолвится в `units.unit_number` — скрипт выводит список «требует ручной резолв» и не мигрирует эти строки
- Если `received_by` uid не резолвится в staff_users — аналогично

После миграции legacy `packages` делается read-only (переименовывается в `_legacy_packages`).

---

## 7. Acceptance criteria

- [ ] Миграция создаёт `packages_v2` с 5 индексами из §2
- [ ] Все 6 инвариантов из §2 enforced (CHECK + service)
- [ ] State machine §3 enforced в service — попытка `picked_up → awaiting_pickup` возвращает 409
- [ ] POST /packages триггерит `enqueueNotification` с event_type `package.received` в той же транзакции
- [ ] SLA scheduled job (7/14/30 дней) реализован; unit-тест с мок-временем
- [ ] `/api/v1/packages/mine` показывает резиденту свои + unit-посылки; RBAC тест
- [ ] `POST /packages/:id/pickup` с `picked_up_by_resident_id` и `picked_up_by_name` одновременно — 400
- [ ] `POST /packages/:id/mark-lost` без `confirm: true` — 400
- [ ] Audit-запись создаётся на каждую мутацию, с правильным `actor_staff_id`
- [ ] Rate-limits enforced (30/min POST, 1/hour remind)
- [ ] Миграционный скрипт идемпотентен; pre-check report перед запуском
- [ ] Интеграционный тест e2e: приём → notification в outbox → pickup → confirmation в outbox → обе в `notification_log_v2`

---

## 8. Open questions (резолюции)

**Q1. `unit_id NOT NULL` — что с legacy-строками без адреса?**
A: Строго NOT NULL в схеме. Legacy-строки с нерезолвимым `recipient_apartment` при миграции переводятся в ручной bucket — скрипт выводит их списком, оператор мигрирует вручную (обычно таких < 2% от корпуса). Альтернатива «создать synthetic unit 'UNKNOWN'» отклонена — загрязняет основную таблицу.

**Q2. Что с посылками для гостей?**
A: Не в scope. Посылки — для резидентов unit'а. Если УК принимает гостевые — используют `notes` + `recipient_name_snapshot`, `recipient_resident_id = NULL`, но `unit_id` всё равно указывается (какая квартира зовёт гостя). Если unit неизвестен — не берём посылку (это policy, не техника).

**Q3. Face recognition / биометрия при выдаче?**
A: Не в scope v1. Выдача — по документу (`document_ref` в body — водительское/паспорт). Биометрия — post-launch (BACKLOG).

**Q4. Notifications на разные каналы одновременно (SMS + push + Telegram)?**
A: Да. В payload `enqueueNotification` не указывается конкретный канал — outbox сам fan-out'ит по каналам, настроенным у резидента в `push_subscriptions` + `residents.phone` + `residents.telegram_chat_id`. Детали — в outbox-спеке §2.

**Q5. Автопереход awaiting → returned через 14 дней?**
A: Нет. Возврат требует физического действия (вынести курьеру). Через 30 дней — alert, но не автоматический status-change. Status меняет только человек.

**Q6. Что если резидент, указанный в `recipient_resident_id`, удалён из unit?**
A: `ON DELETE SET NULL`. Посылка остаётся в системе с `recipient_resident_id = NULL`, `recipient_name_snapshot` сохраняет контекст. Любой active resident unit'а может забрать — это бизнес-policy (квартира общая).

**Q7. Версионирование фото (если перефотографировали)?**
A: Нет. Замена через PATCH просто перезаписывает `photo_url`. Если нужна история — audit log содержит before/after.

**Q8. Какую размерность indexing `storage_location`?**
A: Не индексируем. Поле — свободный текст для поиска в UI (concierge ищет «где лежит посылка Ивановых»). Frequent-use — через full-text search на `notes + storage_location` (отдельный GIN-индекс, post-launch если нужно).

---

## 9. Приложение — happy-path UI flow

**Resident side:**
1. Приходит push «Вам посылка» → открывает Packages → видит card c photo/carrier/tracking
2. Подходит к ресепшн → охрана сканирует QR резидента → видит active-посылки unit → выдаёт → в log

**Staff side:**
1. Курьер на ресепшн → concierge открывает POST flow → сканирует tracking_number (автозаполнение carrier если известен паттерн) → фото коробки через камеру (upload) → выбор unit → recipient_resident_id если пометка есть → save
2. Система пушит notification, создаёт audit-запись
3. При выдаче — open /packages/mine для резидента → pickup endpoint с `picked_up_by_resident_id = scanned_QR.subject_id`

Детали UI — в Phase 5 frontend-спеке, которая будет написана при старте impl.
