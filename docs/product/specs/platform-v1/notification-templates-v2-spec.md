# Module Spec — `notification_templates_v2` (platform-v1)

**Фаза:** 6 (legacy content migration)
**Статус:** Draft (2026-04-24) — разблокирует миграцию текстов из hard-coded копий в DB
**Связано:** `ROADMAP.md` §«Фаза 6»; `notifications-outbox-spec.md`; `notification-log-v2-spec.md`
**Схема-база:** новый модуль (не покрыт мастер-спекой `domhub-access-data-model-spec.md`)
**Существующий код (до P3):** строковые литералы в `backend/src/v1/services/packages.js` (3 локации) + helper `buildPackageReceivedBody`.

---

## 1. Назначение

`notification_templates_v2` — **централизованное хранилище текстов** (title/body/url) для всех уведомлений, отправляемых через `notifications_outbox`. До Phase 6 тексты были зашиты в коде сервисов, что:

1. **Блокирует копирайтера** — правка «Вам посылка» → «Поступила посылка» требует релиза backend'а.
2. **Исключает локализацию** — строка всегда на русском, нельзя отдать тому же резиденту английский вариант по его языку профиля.
3. **Не аудируется** — нет ответа на вопрос «кто и когда правил уведомление о получении посылки?».
4. **Не кастомизируется per-property** — премиум-объект «Резиденции Замоскворечья» не может иметь свой тон в отличие от обычного «Комфорта».

**Что меняется:**
- Producer (service) вместо inline-строк вызывает `renderTemplate(db, 'package.received', variables)` и получает `{ subject, body, url }`.
- Текст шаблона хранится в `notification_templates_v2` (per-property DB), может правиться через админ-UI в Phase 7+.
- Сид-миграция `022_notification_templates_v2.js` заполняет стартовый набор шаблонов (package.*), точный клон прежнего копирайтинга — рефактор behavior-preserving.

**Что НЕ меняется:**
- Payload shape в `notifications_outbox.payload` — по-прежнему `{title, body, url, ...extra}`.
- Channel-adapters (web_push / sms / telegram) читают `payload.title` и `payload.body` как раньше.
- Логика «когда и кому отправить» остаётся в сервисах (packages.js, announcements.js и т.п.) — шаблоны отвечают только за **текст**.

---

## 2. Схема

```
notification_templates_v2
  id             UUID PK
  template_key   VARCHAR(80)  NOT NULL           -- e.g. 'package.received'
                                                  -- соответствует outbox.event_type 1-к-1
  channel        VARCHAR(20)  NULL               -- web_push|sms|telegram|webhook|email
                                                  -- NULL = «применимо к любому каналу»
  locale         VARCHAR(10)  NOT NULL DEFAULT 'ru'
  subject        TEXT         NULL               -- title; NULL для SMS/telegram-only
  body           TEXT         NOT NULL           -- required (see CHECK below)
  url_template   TEXT         NULL               -- e.g. '/packages/{{package_id}}'
  description    TEXT         NULL               -- человекочитаемое назначение (для admin UI)
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()

  CHECK length(trim(body))         > 0
  CHECK length(trim(template_key)) > 0
  CHECK channel IS NULL OR channel IN ('web_push','sms','telegram','webhook','email')
```

Индексы:
- `UNIQUE (template_key, COALESCE(channel,'__any__'), locale)` — expression-index (NULL channel обрабатывается sentinel'ом).
- `(template_key, locale) WHERE is_active = TRUE` — lookup для renderTemplate.

**Почему channel NULLABLE:** большинство шаблонов имеют один текст, одинаково подходящий под sms/web_push. Хранить 2+ копий одного текста — дублирование. NULL channel → «любой канал, если нет более специфичного».

**Почему не CHECK subject IS NOT NULL для web_push:** валидация на уровне БД избыточна — если копирайтер сохранил web_push-шаблон без subject, canonical behavior — `subject: null` в rendered, адаптер разберётся (web-push API принимает сообщение без title, покажется `"Notification"`). Проще исправить текст, чем ловить constraint violation в админке.

---

## 3. Fallback-цепочка рендера

`renderTemplate(db, templateKey, variables, { channel, locale })`:

| Приоритет | Условие | Пример |
|---|---|---|
| 1 (exact) | `channel = X, locale = Y` | `(package.received, sms, en)` |
| 2 (any-channel) | `channel IS NULL, locale = Y` | `(package.received, NULL, en)` |
| 3 (ru-fallback) | `channel = X, locale = 'ru'` | `(package.received, sms, ru)` |
| 4 (full-fallback) | `channel IS NULL, locale = 'ru'` | `(package.received, NULL, ru)` |

Реализация — один SQL с `ORDER BY CASE` (см. `services/notificationTemplates.js`). Если ни один кандидат не найден — `TemplateNotFoundError { code: 'TEMPLATE_NOT_FOUND' }`, worker помечает outbox `failed` (не retry — конфигурация, не транзиент).

**Инвариант:** для каждого `template_key`, используемого в коде, должен быть как минимум один шаблон с `channel=NULL, locale='ru'`. Это гарантируется seed'ом в миграции; разработчик, добавляющий новый `template_key`, обязан добавить seed-строку в миграцию, иначе worker сломается.

---

## 4. Шаблонный язык

Мини-mustache (см. `interpolate()` в `services/notificationTemplates.js`):

| Синтаксис | Значение |
|---|---|
| `{{var}}` | Подстановка `String(variables[var])`. Если var не задана/null/undefined → пустая строка. |
| `{{#var}}...{{/var}}` | Включить фрагмент, если `variables[var]` truthy. |
| `{{^var}}...{{/var}}` | Включить фрагмент, если `variables[var]` falsy. |

**Пример** — стартовый `package.received` body:
```
Посылка{{#sender_name}} от {{sender_name}}{{/sender_name}}{{#carrier}} ({{carrier}}){{/carrier}}{{#storage_location}} — хранение: {{storage_location}}{{/storage_location}}{{^storage_location}} ожидает на ресепшн.{{/storage_location}}
```

При `variables = { sender_name: 'Иванов', carrier: 'CDEK', storage_location: 'shelf-A' }` → `Посылка от Иванов (CDEK) — хранение: shelf-A`.

**Почему мини-mustache, а не handlebars/полный mustache:** покрывает текущий use case в 20 строках, не тянет npm-зависимость, не выполняет произвольный JS (XSS-safe для server-side рендера). Поднимемся до полноценного mustache при появлении need'а для partials/helpers.

---

## 5. Seed и ownership

**Seed** — в самой миграции `022_notification_templates_v2.js`, через `INSERT ... ON CONFLICT DO NOTHING`. Каждый property DB при первом запуске миграций получает идентичный стартовый набор; дальнейшее редактирование — независимое на каждом объекте.

**Начальный набор (Phase 6):**

| template_key | channel | subject | body (markdown-escape) |
|---|---|---|---|
| `package.received` | NULL | Вам посылка | Посылка{{#sender_name}} от {{sender_name}}{{/sender_name}}... |
| `package.picked_up_confirmation` | NULL | Посылка получена | Вы получили посылку — подтверждено на ресепшн. |
| `package.pickup_reminder` | NULL | Напоминание: посылка ждёт вас | Ваша посылка на ресепшн уже {{days_waiting}} дней. Пожалуйста, заберите. |

**Расширение набора (следующие фазы):**

| Когда | template_key | Источник |
|---|---|---|
| Phase 7 (access-core wiring) | `pass.issued`, `pass.revoked`, `guest.arrived` | existing notificationService.js hard-coded bodies |
| Phase 7+ | `announcement.published`, `request.assigned` | когда эти события начинают слать уведомления через outbox |
| Phase 8+ | локализация en / доп. каналы | admin UI |

---

## 6. Интеграция с producer'ами

### Текущие callsites (после P3):

**packages.js:**
- `createPackage()` — `renderTemplate(client, 'package.received', { sender_name, carrier, storage_location, package_id })`
- `pickupPackage()` — `renderTemplate(client, 'package.picked_up_confirmation', { package_id })` (только при `pickedUpByResidentId`)
- `remindPackage()` — `renderTemplate(client, 'package.pickup_reminder', { days_waiting, package_id })`

### Контракт:

```js
const rendered = await renderTemplate(db, templateKey, variables, { channel, locale });
// rendered = { subject, body, url, templateKey, channel, locale }
```

- `db` — pool ИЛИ pg client. В транзакционном producer передаём client, чтобы read был consistent.
- `channel` — optional; если не передан, fallback-цепочка выберет NULL-channel вариант.
- `locale` — optional, default `'ru'`.
- Ошибка: `TemplateNotFoundError` — producer должен дать упасть транзакции, чтобы не создавать outbox-row без текста.

### Producer укладывает rendered в outbox payload:

```js
const payload = {
  title: rendered.subject,
  body:  rendered.body,
  url:   rendered.url,
  // + domain-specific поля, которые НЕ в шаблоне
  // (для /mine view и analytics — см. trimPayloadForResident)
  package_id: pkg.id,
  sender_name: pkg.sender_name,
  ...
};
```

Channel-adapters читают `payload.title` / `payload.body` — семантика неизменна.

---

## 7. Acceptance criteria

1. **Миграция 022 применяется и идемпотентна:** повторный запуск не бросает (ON CONFLICT DO NOTHING).
2. **Seed-строки существуют:** после миграции `SELECT count(*) FROM notification_templates_v2 WHERE template_key = 'package.received'` → ≥ 1.
3. **renderTemplate возвращает consistent output:** для `variables = { sender_name: 'X', carrier: 'Y', storage_location: null, package_id: 'p' }` body = `Посылка от X (Y) ожидает на ресепшн.` (тест существует).
4. **Fallback цепочка работает:** SELECT без exact-match всё равно возвращает NULL-channel вариант.
5. **TemplateNotFoundError при отсутствии:** `renderTemplate(db, 'nonexistent', {})` → throws с `code: 'TEMPLATE_NOT_FOUND'`.
6. **Behavior-preserving в packages.js:** существующие integration-тесты `v1PackagesService.test.js` зелёные после refactor (с добавленным `templateResponder` моком).
7. **Удалены hard-coded строки:** `grep "'Вам посылка'" backend/src/v1/services/` → 0 matches.

---

## 8. Open questions (резолюция в этой же спеке)

- **Q1:** Нужен ли FK от `template_key` к каталогу event'ов?
  - **A:** Нет. Каталог событий — продуктовая декларация в коде (outbox spec §2), не БД. FK добавит только headache при refactor'ах.

- **Q2:** Хранить ли `updated_by_staff_id` для аудита?
  - **A:** Не в v1-таблице — аудит правок отдельный слой (`property_audit_log`, migration 021). При появлении admin UI (Phase 7+) каждое изменение пишет строку в audit_log с `resource_type='notification_template'`.

- **Q3:** Rendering caching?
  - **A:** Не в v1. Каждый renderTemplate = 1 SELECT ~2ms. При нагрузке >1000 notifications/sec — добавим in-memory LRU (invalidate on admin update).

---

## 9. Post-P3 backlog

Явно не в scope Phase 6, но связаны:

- [ ] `POST/PATCH /api/v1/notification-templates` — admin CRUD.
- [ ] `notification_template_audit_log` wiring — пишем строку в `property_audit_log` при каждом PATCH.
- [ ] Миграция остальных producer'ов — `announcement.*`, `pass.*`, `request.*`.
- [ ] Locale picker в resident-профиле — `users.preferred_locale`, передаётся в renderTemplate.
- [ ] `/api/v1/notification-templates/:key/preview` — админ-UI превью с тестовыми variables.
