# Module Spec — `notification_log_v2` (platform-v1)

**Фаза:** 5 (Content + Notifications)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.9
**Связано:** `notifications-outbox-spec.md` §5 (producer → worker → log relationship)
**Миграция:** `backend/src/v1/migrations/016_notification_log_v2.js` (номер уточняется при старте Phase 5)
**Существующий код:** `backend/src/services/notificationService.js` (legacy inline `logNotification`); legacy table `notification_log` (см. `dbMigrations.js` миграция notification_log)

---

## 1. Назначение

`notification_log_v2` — **журнал фактов доставки** уведомлений. Строка появляется **после** попытки отправки каналом (не до, не «в процессе»). Используется для:
- аудита «что и когда отправили этому резиденту»
- retrospective-диагностики (почему SMS не пришло 2026-04-20 в 18:47)
- метрик доставляемости per-channel / per-event-type
- показа резиденту «история уведомлений» в личном кабинете (P1 фича)

**В legacy** — `notification_log` пишется fire-and-forget из `notificationService.js` сразу после `await sendSms(...)` / `await sendPush(...)`. Недостатки:
- нет ретраев → если канал упал, запись появляется со `status='failed'` и на этом всё
- привязка к `user_id TEXT` — не работает после split `users → residents/staff/contractors`
- нет `property_id` → невозможен per-tenant reporting

**В v1** `notification_log_v2` становится **consumer'ом `notifications_outbox`**: worker-процесс после отправки через канал-адаптер пишет строку в log. Это единственный источник факта доставки.

**Разделение ответственности:**
| Что | Где |
|---|---|
| Запланировать отправку | `notifications_outbox` (см. outbox-спеку) |
| Попытка доставки + ретраи | worker + channel-adapters |
| **Факт доставки (success или final-fail)** | `notification_log_v2` |
| Снэпшот полезной нагрузки для support/audit | `notification_log_v2.payload` |

---

## 2. Схема

```
notification_log_v2
  id                UUID PK
  property_id       UUID NOT NULL
  outbox_id         UUID NULL → notifications_outbox.id
                      (NULL для legacy-записей, замигрированных до outbox cut-over)
  recipient_type    ENUM(resident/staff/contractor/external) NOT NULL
  recipient_id      UUID NULL
                      (→ residents/staff_users/contractor_users в зависимости от recipient_type;
                       NULL для external — например, webhook-URL адресата)
  recipient_address TEXT NULL
                      (fallback: email, phone, telegram_chat_id, webhook-URL — snapshot на момент отправки,
                       на случай если резидент сменил номер и «почему не пришло на старый» надо расследовать)
  channel           ENUM(web_push/sms/telegram/webhook/email) NOT NULL
  event_type        VARCHAR(60) NOT NULL
                      (напр. 'package.received', 'access_request.approved', 'announcement.published')
  status            ENUM(sent/failed) NOT NULL
                      (только финальные статусы; in_flight/pending живут в outbox)
  payload           JSONB NOT NULL
                      (snapshot того, что реально ушло в канал — после шаблонизации, i18n, локализации времени)
  error_code        VARCHAR(40) NULL
                      (классифицированная ошибка: 'provider_timeout', 'invalid_recipient', 'quota_exceeded', ...)
  error_message     TEXT NULL
                      (raw provider-response для диагностики)
  provider_message_id TEXT NULL
                      (ID сообщения у провайдера: Twilio SID, FCM message_id, Telegram update_id — для поиска в админке провайдера)
  attempt_count     SMALLINT NOT NULL
                      (сколько попыток отнял outbox до финала; 1 = первая попытка, >1 = были retry)
  sent_at           TIMESTAMPTZ NOT NULL
                      (время финальной попытки — success либо последнего fail перед dead)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
```

Индексы:
- `(property_id, created_at DESC)` — per-tenant timeline
- `(property_id, recipient_type, recipient_id, created_at DESC)` — «история для резидента X»
- `(property_id, event_type, created_at DESC)` — metrics per-event-type
- `(property_id, channel, status, created_at DESC)` — delivery-rate per-channel
- `outbox_id` UNIQUE partial WHERE `outbox_id IS NOT NULL` — гарантия 1-to-1 с outbox

**Инварианты:**
- `status='sent'` ⇒ `error_code IS NULL AND error_message IS NULL`
- `status='failed'` ⇒ `error_code IS NOT NULL` (error_message может быть NULL если канал не вернул тела ответа)
- `recipient_type='external'` ⇒ `recipient_id IS NULL` (адрес только в `recipient_address`)
- `recipient_type IN ('resident','staff','contractor')` ⇒ `recipient_id IS NOT NULL` (snapshot кем был адресат)

---

## 3. API

### 3.1 Producer (worker)

**Не** HTTP — внутренний вызов из worker'а outbox после завершения попытки.

```js
// backend/src/v1/services/notificationLog.js
async function recordDelivery(tx, {
  propertyId,
  outboxId,
  recipientType,
  recipientId,
  recipientAddress,
  channel,
  eventType,
  status,           // 'sent' | 'failed'
  payload,
  errorCode,
  errorMessage,
  providerMessageId,
  attemptCount,
}) {
  // single INSERT, returns the row
}
```

Вызывается worker'ом в той же транзакции, в которой он помечает `outbox.status='sent'` или `'dead'` (см. `notifications-outbox-spec.md` §3 state machine).

**Важно:** `recordDelivery` вызывается **один раз на outbox-запись** — в момент финала (success или dead). Промежуточные fail'ы (которые пойдут в retry) в log не пишутся — там только outbox.last_error для диагностики.

### 3.2 Read API (admin + резидент own)

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/admin/notification-log?recipient_type=&recipient_id=&channel=&event_type=&status=&since=&until=&limit=` | `property_admin` | Журнал per-tenant с фильтрами |
| `GET` | `/api/v1/admin/notification-log/:id` | `property_admin` | Детали (включая payload, error_message, provider_message_id) |
| `GET` | `/api/v1/notification-log/mine?limit=50` | `resident` | Свои уведомления (фильтр `recipient_type='resident' AND recipient_id = req.subject.id`); payload урезан — без internal-полей |
| `GET` | `/api/v1/admin/notification-log/metrics?period=24h\|7d\|30d` | `property_admin` | Агрегаты: success-rate per-channel, top event_types, top errors |

**Лимиты:**
- `limit` default 50, max 500
- `since`/`until` обязательны если `recipient_id` не задан (избегаем full-scan)
- `/mine` только по своим записям (`recipient_type='resident' AND recipient_id = subject`)

---

## 4. Миграция из legacy

### 4.1 Стратегия

**Не копируем** legacy `notification_log` в `notification_log_v2`. Причины:
- legacy-записи не имеют `property_id` (single-tenant эра)
- `user_id TEXT` → `recipient_id UUID` маппинг хрупкий (uid→resident_id через `residents.external_uid`)
- legacy-payload-формат не гарантирован (разные версии писали разное)

**Вместо этого:**
1. Legacy-таблица `notification_log` остаётся read-only для support (архив за предыдущий год)
2. С момента go-live Phase 5 — все новые записи идут только в `notification_log_v2`
3. UI-фича «мои уведомления» для резидента показывает только v2-записи (без смешения)

### 4.2 Legacy channel → v1

| Legacy event | v1 event_type |
|---|---|
| `notification_log.event_type='package_received'` | `package.received` (точечный формат `{entity}.{action}`) |
| `notification_log.event_type='request_approved'` | `access_request.approved` |
| inline `notificationService.sendTo(...)` без log-вызова | эти были lost — в v2 outbox гарантирует log |

Унификация формата `event_type` в точечную нотацию — см. §6 open questions, резолюция #3.

---

## 5. Связь с `notifications_outbox`

Прямая цитата из `notifications-outbox-spec.md §5` (для согласованности):

> Миграция из legacy: `logNotification(...)` (fire-and-forget INSERT в `notification_log`) → `notification_log_v2` row после успешной отправки worker'ом. Единственный источник «факт доставки» — worker, не producer.

**Sequencing в worker'e:**

```
BEGIN;
  SELECT ... FROM notifications_outbox WHERE id = $1 FOR UPDATE;
  -- channel adapter .send() уже вызван ВНЕ транзакции
  IF result.ok THEN
    UPDATE notifications_outbox SET status='sent', sent_at=now(), ... WHERE id=$1;
    INSERT INTO notification_log_v2 (status='sent', ...);
  ELSE IF attempt_count >= max_attempts THEN
    UPDATE notifications_outbox SET status='dead', ... WHERE id=$1;
    INSERT INTO notification_log_v2 (status='failed', ...);
  ELSE
    UPDATE notifications_outbox SET status='pending', next_attempt_at=..., attempt_count=attempt_count+1, last_error=... WHERE id=$1;
    -- НЕ пишем в notification_log_v2 (ещё не финал)
  END IF;
COMMIT;
```

Это гарантирует: одна outbox-запись → либо **ровно одна** log-запись (финал), либо ноль log-записей (если outbox всё ещё pending/in_flight). Без дублей.

---

## 6. Acceptance criteria

- [ ] Миграция создаёт `notification_log_v2` с 5 индексами из §2
- [ ] Все 4 инварианта из §2 enforced (DB CHECK constraints где возможно, service-level для остальных)
- [ ] Worker в outbox-цикле вызывает `recordDelivery` ровно один раз на финальный исход; unit-тест покрывает «attempt 1 fails → attempt 2 succeeds → log row count == 1, status='sent', attempt_count=2»
- [ ] `/api/v1/admin/notification-log` отдаёт paginated list с фильтрами из §3; тест покрывает required `since`/`until` когда нет `recipient_id`
- [ ] `/api/v1/notification-log/mine` не показывает чужие записи; RBAC-тест с двумя резидентами
- [ ] `/api/v1/admin/notification-log/metrics` считает success-rate корректно для последних 24h/7d/30d
- [ ] Legacy `notification_log` не удалена, read-only для support
- [ ] Payload в API-ответе урезан для `/mine` (нет internal-полей: `provider_message_id`, raw `error_message`)
- [ ] Retention policy применяется: rows старше 180 дней — архивируются или удаляются (см. §7 open question #4, резолюция — retention 365 дней, hard delete)
- [ ] Интеграционный тест полного пути: `enqueueNotification` → worker → adapter → `notification_log_v2` row с правильным `outbox_id` и `provider_message_id`

---

## 7. Open questions (резолюции)

**Q1. Хранить ли payload после успешной отправки?**
A: Да, но с TTL. Для `status='sent'` payload хранится 90 дней, потом обнуляется (`payload = '{}'::jsonb`) — сохраняется только метаданные (кому/когда/каким каналом). Для `status='failed'` — полные 365 дней (нужен для диагностики). Причина: GDPR / 152-ФЗ минимизация, не храним текст уведомлений вечно.

**Q2. Нужен ли индекс на `provider_message_id`?**
A: Нет. Lookup по нему — редкий (support → админка провайдера → ищем «какое наше событие соответствует»). Full-scan по `(property_id, created_at DESC)` + фильтр в WHERE приемлем.

**Q3. Формат `event_type`?**
A: Строгая точечная нотация `{entity}.{action}`: `package.received`, `access_request.approved`, `pass.revoked`, `announcement.published`. Регистрируется в `backend/src/v1/services/notificationEvents.js` как const-таблица с описанием. Unknown `event_type` при `enqueueNotification` → 400.

**Q4. Retention?**
A: 365 дней, hard delete. Запускается раз в сутки через `pg_cron` или BullMQ scheduled job. До удаления — один шанс архивировать в cold storage, но это post-launch feature (BACKLOG). **Exception:** `status='failed'` записи в рамках последних 30 дней не удаляем никогда (пока не разобрали причину).

**Q5. Что с `external` recipient_type (webhook subscribers)?**
A: `recipient_id = NULL`, `recipient_address = webhook URL`. В фильтре `/admin/notification-log?recipient_type=external&channel=webhook` — отдельный view для отладки интеграций.

**Q6. Корреляция с бизнес-событием?**
A: `outbox_id` ведёт в outbox-запись, там есть `correlation_id` — это ID исходного бизнес-события (напр. `access_requests.id`, `packages.id`). Через двухступенчатый JOIN можно ответить «все уведомления по этой заявке». Прямой `correlation_id` в log-таблице дублировать не нужно — переход через outbox дёшев.

**Q7. Резидент видит ли статус 'failed'?**
A: Нет. `/mine` фильтрует WHERE `status='sent'`. Резиденту нет нужды видеть «SMS не дошёл» (это может быть пугающе); для проблем есть support → админка. **Исключение:** в будущей P1 фиче «моя телефонная книга» — там покажем «последняя попытка на этот номер не удалась → обновите» (но это уже UI, не журнал).

---

## 8. Приложение — пример row

```json
{
  "id": "e8a1...",
  "property_id": "zamoskvoreche-uuid",
  "outbox_id": "ff01...",
  "recipient_type": "resident",
  "recipient_id": "resident-uuid",
  "recipient_address": "+79001234567",
  "channel": "sms",
  "event_type": "package.received",
  "status": "sent",
  "payload": {
    "title": "Посылка для вас",
    "body": "Получена на ресепшн: Wildberries, трек 81234567890",
    "locale": "ru-RU"
  },
  "error_code": null,
  "error_message": null,
  "provider_message_id": "SMxxxxxxxxxxxxxxxx",
  "attempt_count": 1,
  "sent_at": "2026-04-23T14:22:15.123Z",
  "created_at": "2026-04-23T14:22:15.456Z"
}
```
