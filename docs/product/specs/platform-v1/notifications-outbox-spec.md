# Module Spec — `notifications_outbox` (platform-v1)

**Фаза:** 5 (Content + Notifications)
**Статус:** Draft (2026-04-23) — разблокирует старт Фазы 5
**Связано:** `BACKLOG.md` P0-2, DOCS-1; `ROADMAP.md` §"Фаза 5"
**Схема-база:** новый модуль, не описан в мастер-спеке (`domhub-access-data-model-spec.md` покрывает access-core)
**Существующий код:** `backend/src/services/notificationService.js` (legacy inline-send)

---

## 1. Назначение

`notifications_outbox` — **transactional outbox** для уведомлений. Единственная цель: гарантировать, что событие, порождённое бизнес-логикой, **не теряется**, если канал доставки (web-push / SMS / Telegram / webhook) временно недоступен.

Сейчас `notificationService.dispatch(event, data, db)` вызывается **inline** внутри route-handler'а, в той же цепочке что и бизнес-мутация. Ошибки канала **проглатываются** (`logger.warn`) — это сознательное решение «не ломать основной флоу». Но обратная сторона — **любое уведомление, которое не доставилось в момент вызова, теряется навсегда**. Для Замоскворечья это означает: падение Telegram на 30 секунд = пропущенные гости, пропущенные подтверждения заявок, пропущенные инциденты.

**Что меняется:**
- Вместо inline-send — `enqueueNotification(event, data)` пишет строку в `notifications_outbox` **в той же транзакции** что и бизнес-мутация.
- Worker (отдельный процесс или setInterval в текущем сервере — см. §7) читает pending-строки, отправляет через channel-adapter, помечает `sent`/`failed`.
- Retry с exponential backoff; после N неудач — `dead`, попадает в «DLQ-view» для ручного разбора.

**Что НЕ меняется:**
- Логика маршрутизации событий по каналам (`guest.arrived → push + sms`, `blacklist.attempt → security+admin`) остаётся в notificationService.
- `notification_log_v2` (Фаза 5, отдельная спека) — по-прежнему **журнал успешных доставок** (facts). Outbox — «in-flight» таблица.

---

## 2. Схема

```
notifications_outbox
  id                UUID PK
  property_id       UUID NOT NULL                    -- multi-tenant scope
  event_type        TEXT NOT NULL                    -- 'guest.arrived', 'request.approved', ...
  channel           ENUM(web_push|sms|telegram|webhook|email)
  recipient_type    ENUM(resident|staff|contractor|vehicle|external)
  recipient_id      UUID NULL                        -- FK resolved at dispatch time
  recipient_address TEXT NULL                        -- phone/endpoint/chat_id snapshot
  payload           JSONB NOT NULL                   -- {title, body, url?, ...}
  status            ENUM(pending|in_flight|sent|failed|dead)  DEFAULT 'pending'
  attempt_count     SMALLINT NOT NULL DEFAULT 0
  max_attempts      SMALLINT NOT NULL DEFAULT 6
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now()  -- scheduled_at
  last_attempted_at TIMESTAMPTZ NULL
  last_error        TEXT NULL                        -- last channel error (truncated 1KB)
  sent_at           TIMESTAMPTZ NULL
  correlation_id    UUID NULL                        -- связь с business entity (pass_id, request_id, ...)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
```

Индексы:
- `(status, next_attempt_at)` partial `WHERE status IN ('pending','failed')` — основной worker-запрос
- `(property_id, created_at DESC)` — observability-view
- `(correlation_id)` — «покажи все уведомления по этой заявке»

Ретенция:
- `status='sent'` — TTL 30 дней (после чего переезжает в `notification_log_v2` как исторический факт и удаляется из outbox)
- `status='dead'` — держим 90 дней для ручного разбора, потом архивируем

Таблица **per-property DB** — как и весь домен. Общего platform-wide outbox нет.

---

## 3. State machine

```
        enqueue                    worker.lock
pending ───────► pending ─────────────────────► in_flight
                   ▲                                │
                   │ retry (backoff)                │ channel.send
          ┌────────┴────────┐                       │
          │                 │                       ▼
          │              failed                  ┌──────┐
          │                 ▲                    │ sent │
          │                 │ attempt < max      └──────┘
          │                 │                       │
          │                 └───────────────────────┤
          │                                    attempt = max
          │                                         │
          │                                         ▼
          └─────────────────────────────────────► dead
```

Инварианты:
- `pending → in_flight` — **атомарный lock** через `UPDATE … WHERE status='pending' AND next_attempt_at <= now() RETURNING id` (no SELECT FOR UPDATE SKIP LOCKED в начальной версии — достаточно advisory-lock на worker-экземпляр).
- `in_flight → sent` — терминал. `sent_at` заполняется.
- `in_flight → failed` — инкремент `attempt_count`, вычисление `next_attempt_at = now() + backoff(attempt_count)`, `last_error` = сообщение канала.
- `failed → pending` — автоматически при `next_attempt_at <= now()` (следующий тик worker'а).
- `* → dead` — одноразовый терминал после `attempt_count >= max_attempts`.
- Никаких `dead → *`-переходов автоматически; admin может вручную `POST /outbox/:id/requeue` (устанавливает `status='pending', attempt_count=0`).

Backoff (минуты): `1, 5, 15, 60, 240, 1440` — итого 6 попыток за ~29 часов, потом `dead`.

---

## 4. API

### 4.1 Producer (server-side, не HTTP)

Единственный публичный helper:

```js
// backend/src/v1/services/notificationOutbox.js
async function enqueueNotification(tx, {
  propertyId, eventType, channel, recipientType, recipientId,
  recipientAddress, payload, correlationId,
});
```

Правила использования:
- **Обязательно** вызывается внутри уже открытой транзакции (`tx`) бизнес-мутации. Иначе outbox теряет смысл (дуальная запись без atomicity).
- Не выбрасывает при «канал недоступен» — поскольку канал ещё не вызывается.
- Выбрасывает только при нарушении constraint'ов БД — и это должно ломать транзакцию.

### 4.2 Admin observability HTTP API

Все роуты под `/api/v1/admin/outbox`, tenant-resolved по hostname, роль `property_admin` или выше.

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/admin/outbox?status=&channel=&from=&to=&q=` | Список (с фильтрами, по умолчанию последние 100) |
| `GET` | `/admin/outbox/:id` | Детали: payload, все attempts, ошибки |
| `POST` | `/admin/outbox/:id/requeue` | Переставить `dead` или `failed` → `pending`, attempt_count=0 |
| `POST` | `/admin/outbox/:id/cancel` | `pending`/`failed` → `dead` вручную (не отправлять больше) |
| `GET` | `/admin/outbox/metrics` | Prometheus-compatible: `notifications_outbox_pending{channel,property}`, `..._dead`, `..._sent_total`, `..._attempt_latency_seconds` |

### 4.3 Worker

**Не HTTP-сервис.** Два варианта (см. §7 Open questions):

- **A. In-process:** `setInterval` в том же Node-процессе, `tick()` каждые 5 секунд, блокировка через advisory-lock (`SELECT pg_try_advisory_lock(hashtext('outbox-' || property_id))`).
- **B. Отдельный процесс:** `backend/src/workers/outboxWorker.js`, запускается через PM2/systemd, БД-level lock — тот же.

Обе читают:
```sql
SELECT id, channel, recipient_address, payload
  FROM notifications_outbox
 WHERE status = 'pending'
   AND next_attempt_at <= now()
 ORDER BY next_attempt_at
 LIMIT 50;
```

…помечают `in_flight`, вызывают `channelAdapter.send(...)`, пишут результат.

### 4.4 Channel adapter

```js
// backend/src/v1/services/channels/index.js
const adapters = {
  web_push: require('./webPushAdapter'),
  sms:      require('./smsAdapter'),
  telegram: require('./telegramAdapter'),
  webhook:  require('./webhookAdapter'),
  email:    require('./emailAdapter'),  // Phase 5+, может быть пустым stub
};

// каждый exposes:
// async function send({ recipientAddress, payload, tenant }) → { ok: boolean, error?: string }
```

Logic из текущего `notificationService.js` (`sendWebPush`, `sendTelegram`, `sendSms`, `webhookService.sendEvent`) переносится as-is в соответствующие adapter-файлы. Dead-endpoint handling для web-push (410/404 → deactivate subscription) остаётся в adapter'е, не в worker'е.

---

## 5. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `notificationService.dispatch(event, data, db)` вызов из route-handler'а | `enqueueNotification(tx, {...})` + исполнение в worker | `tx` = транзакция текущего HTTP-handler'а |
| `logNotification(...)` (fire-and-forget INSERT в `notification_log`) | `notification_log_v2` row после успешной отправки worker'ом | Единственный источник «факт доставки» — worker, не producer |
| `sendWebPush/sendTelegram/sendSms` inline | `channels/*Adapter.send(...)` | Логика без изменений, интерфейс единый |
| Event types: `guest.arrived`, `request.approved`, `request.rejected`, `announcement.published`, `blacklist.attempt`, `package.arrived`, `booking.confirmed`, `meter.reminder`, `billing.overdue` | те же | Таксономия расширяется в `domhub-event-taxonomy-spec.md` (DOCS-7) |

Путь cut-over:
1. Создать `notifications_outbox` + adapter-файлы (non-breaking, рядом с существующим `notificationService`).
2. Добавить feature-flag `notifications.outbox_enabled` (default `false`).
3. Новая логика: `enqueueNotification()` + worker активируется при флаге. При `false` — fallback в старый inline-path.
4. Включить флаг на staging, прогнать нагрузочный тест (LOAD-1).
5. Включить на Замоскворечье после успешного drill.
6. Удалить legacy inline-path в следующей фазе (Phase 6 или пост-релиз), когда старый код уже точно не вызывается.

---

## 6. Acceptance criteria

- [ ] Миграция `0XX_notifications_outbox.sql` применяется с нуля и на копии property-DB без ошибок; индексы созданы.
- [ ] `enqueueNotification(tx, {...})` откатывается вместе с бизнес-транзакцией при rollback (unit + integration test).
- [ ] Worker обрабатывает `pending → sent` за < 10 секунд в нормальном режиме (integration-тест с mock-adapter'ом).
- [ ] При `channel.send` exception — строка переходит в `failed` с корректным `next_attempt_at` по backoff-формуле; ретест `failed → pending → in_flight → sent` на следующем тике.
- [ ] После `attempt_count >= max_attempts` — `dead`, дальнейших попыток не происходит.
- [ ] Advisory-lock предотвращает двойную обработку одной строки двумя worker-экземплярами (параллельный тест).
- [ ] `POST /admin/outbox/:id/requeue` возвращает строку в `pending`, audit-запись в `property_audit_log`.
- [ ] Prometheus endpoint отдаёт метрики в формате `notifications_outbox_pending{channel="telegram",property="<uuid>"} 42`.
- [ ] Feature-flag `notifications.outbox_enabled` переключает path корректно; при `false` legacy-код не трогается.
- [ ] Load-test (LOAD-1): при rate 100 req/s с `announcement.published` на 500 резидентов outbox заполняется за < 30 секунд, worker успевает обрабатывать fanout без back-pressure collapse.

---

## 7. Открытые вопросы и резолюции

1. **In-process worker или отдельный процесс?** → **Резолюция:** in-process на старте (упрощает deploy на Timeweb single-VPS). Переход на отдельный процесс — когда `notifications_outbox_pending` стабильно > 1000 строк или HTTP-latency деградирует. Закреплено флагом `NOTIFICATIONS_WORKER_MODE=inprocess|external`.

2. **Ordering guarantees?** → **Резолюция:** частичное ordering per-recipient-per-channel. Worker читает `ORDER BY next_attempt_at` — глобальный порядок по времени постановки в очередь не гарантирован при параллельной обработке. Для бизнеса достаточно: «резидент получит `request.approved` перед `request.used`», поскольку вторая мутация не произойдёт, пока первый пасс не выдан. Formally — за пределами spec, но not a bug.

3. **Backpressure на массовые рассылки (announcement.published → 500+ резидентов)?** → **Резолюция:** producer пишет 1 строку `pending` на каждого получателя (fan-out **в producer'е**, не в worker'е). Это сохраняет per-recipient retry/failure и делает ретенцию предсказуемой. Batch-вставка через `INSERT … VALUES (...), (...), ...` в 1 запросе — ограничение Postgres (~65535 параметров / 5 ≈ 13000 строк за batch). Для Замоскворечья (~500 квартир) — 1 batch.

4. **Связь с `notification_log_v2` (Фаза 5, отдельная спека)?** → **Резолюция:** после `status='sent'` worker пишет ОДНОВРЕМЕННО: `sent_at` в outbox + INSERT в `notification_log_v2` с фактом доставки. Обе записи в одной транзакции. Retention: outbox чистится через 30 дней, log_v2 держится индефинитно (history of truth). Детализация таблицы log_v2 — в `notification-log-v2-spec.md` (TODO, Фаза 5).

5. **Что с webhook-каналом (external integrations)?** → **Резолюция:** webhook — обычный channel-adapter наравне с sms/push. HMAC-подпись в payload'е — ответственность adapter'а. Retry-политика та же. Отказ внешнего webhook'а не влияет на internal channels.

6. **Шифрование payload at-rest?** → **Резолюция:** payload содержит имя гостя, номер квартиры, возможно номер машины — это персональные данные. В v1 — полагаемся на disk-encryption Timeweb + row-level permissions; column-level encryption откладывается до DOCS-6 (threat model). Явно помечено как gap в `DOCS-6`.

7. **Пере-использование `push_subscriptions` таблицы из legacy?** → **Резолюция:** да, используем as-is — таблица уже multi-tenant (scoped by property). Dead-endpoint handling (410/404 → `is_active=false`) переносится в `webPushAdapter` без изменений.

---

## 8. Связанные документы

- `docs/product/specs/platform-v1/README.md` — индекс module-specs
- `docs/product/specs/platform-v1/passes-spec.md` — §8 описывает формат
- `BACKLOG.md` §📚 — DOCS-7 (event taxonomy) дополняет таксономию event_type
- `ROADMAP.md` §"Фаза 5" — scope Фазы 5
- `docs/product/specs/domhub-deployment-and-tenant-ops-spec.md` — как outbox мониторится в продакшне
