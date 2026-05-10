# Module Spec — `documents_v2` (platform-v1)

**Фаза:** 5 (Content + Notifications)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.8
**Миграция:** `backend/src/v1/migrations/018_documents_v2.js`
**Существующий код:** `backend/src/routes/documents.js` + legacy table `documents` (`dbMigrations.js` lines 380–392)

---

## 1. Назначение

`documents_v2` — статический контент резидентского портала: правила проживания, контакты УК, инструкции («как вызвать сантехника»), тексты договоров, нормативные документы. Показывается в личном кабинете резидента и на публичной странице объекта (для правил и контактов).

**Legacy-модель (`documents`) проблемы:**
- Нет `property_id` → single-tenant схема
- `body TEXT` — без указания формата (HTML? plain? Markdown?). Фронт рендерит как plain text, что ломает списки/ссылки
- `version INTEGER` увеличивается руками, но нет истории — предыдущая версия теряется
- `author_id TEXT REFERENCES users(uid)` — не работает после split users
- `category VARCHAR(50)` CHECK enum — fixed список `rules/contacts/instructions/contracts/other`; UC «пожарная безопасность» не вписывается

**v2-модель:**
- Явный `property_id` — per-tenant документы
- `body_md TEXT` — Markdown, фронт рендерит через единый sanitizer
- Категория — расширяемый enum + кастомный `tag` поверх для гибкости
- `file_url` — ссылка на подписанный PDF/DOCX (через UPLOAD_SIGNING_SECRET, см. `backend/src/middleware/uploadSigning.js`)
- `sort_order` остаётся — УК контролирует порядок в личном кабинете
- История версий — вынесена в отдельную таблицу `document_versions` (см. §2.2), без автоматического bumping

---

## 2. Схема

### 2.1 `documents_v2`

```
documents_v2
  id                UUID PK
  property_id       UUID NOT NULL
  title             TEXT NOT NULL
  category          ENUM(rules/contacts/instructions/contracts/safety/legal/other) NOT NULL
  tag               VARCHAR(40) NULL
                      (свободный ярлык для группировки в UI; lowercase kebab-case;
                       напр. 'fire-safety', 'water-shutoff-schedule')
  body_md           TEXT NULL
                      (Markdown-контент; рендерится через common sanitizer;
                       NULL если документ — только файл)
  file_url          TEXT NULL
                      (URL подписанного /uploads/ пути;
                       NULL если документ — только текст)
  file_mime         VARCHAR(60) NULL
                      (application/pdf / application/vnd.openxmlformats-officedocument.wordprocessingml.document / ...)
  file_size_bytes   INTEGER NULL
  is_public         BOOLEAN NOT NULL DEFAULT false
                      (true = доступен без auth, показывается на /public/:property/documents)
  sort_order        INTEGER NOT NULL DEFAULT 0
                      (в рамках (property_id, category) — меньше сначала)
  published_at      TIMESTAMPTZ NULL
                      (NULL = draft; NOT NULL = опубликован)
  created_by_staff_id  UUID NULL → staff_users
  updated_by_staff_id  UUID NULL → staff_users
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  deleted_at        TIMESTAMPTZ NULL
                      (soft delete; не показывается ни резидентам ни в админ-листе
                       без явного ?include_deleted=1)
```

Индексы:
- `(property_id, category, sort_order)` — основной list-запрос в UI
- `(property_id, is_public, published_at) WHERE deleted_at IS NULL AND published_at IS NOT NULL` — publicly-visible partial index
- `(property_id, tag) WHERE tag IS NOT NULL` — ярлыки
- `updated_at DESC` — «недавно обновлённые»

**Инварианты (CHECK + service-level):**
- `body_md IS NOT NULL OR file_url IS NOT NULL` — документ не может быть пустым
- `file_url IS NOT NULL ⇒ file_mime IS NOT NULL AND file_size_bytes IS NOT NULL`
- `file_url` должен начинаться с `/uploads/` (валидация в роуте — не позволяем внешние URL, см. CLAUDE.md Troubleshooting §Uploads)
- `published_at ≤ now()` — нельзя опубликовать в будущем (для этого используется announcements с `starts_at`)
- `deleted_at IS NOT NULL ⇒ deleted_at ≥ created_at`

### 2.2 `document_versions` (опционально для v1 — см. §7 Q2)

```
document_versions
  id              UUID PK
  document_id     UUID NOT NULL → documents_v2
  version         INTEGER NOT NULL
  title_snapshot  TEXT NOT NULL
  body_md_snapshot TEXT NULL
  file_url_snapshot TEXT NULL
  archived_by_staff_id UUID NULL → staff_users
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  reason          TEXT NULL
```

Индексы: `(document_id, version DESC) UNIQUE`.

**Когда создаётся строка:** при каждом PATCH, если изменилось `body_md`, `title` или `file_url` — перед UPDATE снимаем снэпшот старой версии в `document_versions`.

**Hot path:** резидент читает `documents_v2` — не затрагивает `document_versions`. Версии нужны только для аудита УК.

---

## 3. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/documents?category=&tag=&include_draft=` | `resident`, `staff` | Список с фильтрами; резидент видит только `is_public=true OR published_at IS NOT NULL AND deleted_at IS NULL`; staff видит всё кроме soft-deleted |
| `GET` | `/api/v1/documents/:id` | `resident`, `staff` | Детали; резидент — только опубликованные |
| `GET` | `/api/v1/public/:property_slug/documents` | — (без auth) | Publicly-visible list: `is_public=true AND published_at IS NOT NULL AND deleted_at IS NULL` |
| `POST` | `/api/v1/documents` | `property_admin`, `concierge` | Создание; `published_at` опционально — без него создаётся как draft |
| `PATCH` | `/api/v1/documents/:id` | `property_admin`, `concierge` | Обновление; если меняется body_md/title/file_url — снимает предыдущую версию в `document_versions` |
| `POST` | `/api/v1/documents/:id/publish` | `property_admin`, `concierge` | Устанавливает `published_at=now()`; idempotent если уже опубликован |
| `POST` | `/api/v1/documents/:id/unpublish` | `property_admin` | `published_at = NULL`; резиденты перестают видеть |
| `DELETE` | `/api/v1/documents/:id` | `property_admin` | Soft delete (`deleted_at=now()`) |
| `GET` | `/api/v1/documents/:id/versions` | `property_admin` | История версий (из `document_versions`) |
| `GET` | `/api/v1/documents/:id/versions/:version` | `property_admin` | Один snapshot |

**Capability-gate на запись:**
- `property_admin` — все операции
- `concierge` — только POST/PATCH/publish/unpublish в категориях `contacts`, `instructions` (не `legal`, `contracts`, `safety`). Enforce в service через whitelist per-capability.
- `security`, `resident` — readonly

**Public endpoint:**
- `/api/v1/public/:property_slug/documents` — не требует auth
- Возвращает **только** категории `rules`, `contacts`, `safety` (legal/contracts требуют auth даже если `is_public=true` — по соображениям приватности договоров)
- `slug → property_id` резолвится через platform-таблицу `properties`
- Rate-limit: 60 req/min per-IP

---

## 4. Миграция из legacy

| Legacy | v1 | Правило |
|---|---|---|
| `documents.body TEXT` | `documents_v2.body_md` | Копируется как-есть; legacy body уже полу-markdown в части записей, полу-plain в остальных — **принимаем как Markdown** (валидные URL в plain-text остаются ссылками в MD) |
| `documents.category='rules'\|'contacts'\|'instructions'\|'contracts'\|'other'` | `documents_v2.category` (same enum values) | 1-to-1 копирование значений |
| `documents.version INTEGER` | игнорируется; в v2 version отслеживается через `document_versions.version` | При миграции создаётся одна запись в `document_versions` с `version=legacy.version`, остальная история потеряна (у нас её всё равно нет) |
| `documents.author_id TEXT → users(uid)` | `created_by_staff_id UUID → staff_users` | Резолв через `staff_users.external_uid = legacy.author_id`; если не найден — `NULL` (legacy author ушёл) |
| `documents.file_url TEXT` | `file_url + file_mime + file_size_bytes` | mime/size заполняются отдельным backfill-скриптом через HEAD-запрос к `/uploads/` |
| `documents.is_public` | `documents_v2.is_public` | 1-to-1 |
| `documents.sort_order` | `documents_v2.sort_order` | 1-to-1 |
| `documents.deleted_at` | `documents_v2.deleted_at` | 1-to-1; legacy soft-delete column |

**Миграционный скрипт** (`scripts/migrate-documents-to-v2.js`):
1. Для каждой row в legacy `documents`: INSERT в `documents_v2` с резолвом `author_id → created_by_staff_id`
2. INSERT в `document_versions` с `version = legacy.version`, snapshot текущих полей
3. `property_id` = ID текущего объекта (при миграции этого tenant'а)
4. `published_at` = `legacy.created_at` (всё что было в legacy — считаем published; draft не было в модели)
5. Backfill `file_mime`/`file_size_bytes` — отдельный pass после основной миграции

После миграции legacy `documents` делается read-only (переименовывается в `_legacy_documents`), v1-код не читает.

---

## 5. Acceptance criteria

- [ ] Миграция создаёт `documents_v2` и `document_versions` с индексами из §2
- [ ] Все 5 инвариантов из §2.1 enforced (CHECK где возможно, service-level для остального)
- [ ] `/api/v1/documents` возвращает резиденту только опубликованные и не-удалённые
- [ ] `/api/v1/public/:property_slug/documents` работает без auth, возвращает только `rules/contacts/safety`, rate-limited
- [ ] `/api/v1/documents` с `include_draft=1` для staff возвращает draft-документы (`published_at IS NULL`)
- [ ] PATCH, изменяющий `body_md`/`title`/`file_url`, создаёт row в `document_versions` со snapshot'ом; тест покрывает 2 последовательные правки → 2 версии
- [ ] `concierge` **не** может создать документ категории `legal` или `contracts` (403)
- [ ] `file_url` принимает только пути, начинающиеся с `/uploads/` (400 на внешние URL)
- [ ] Soft-deleted документ не видят ни резиденты, ни в `/admin/documents` без `?include_deleted=1`
- [ ] Миграционный скрипт идемпотентен (запуск дважды не дублирует записи; используется UNIQUE constraint или MERGE pattern)
- [ ] Markdown-рендер на фронте использует sanitizer (DOMPurify или аналог) — XSS-тест с `<script>` payload в `body_md`
- [ ] `document_versions` запись создаётся в той же транзакции с UPDATE в `documents_v2` — нет окна когда версии расходятся

---

## 6. Связь с уведомлениями

`documents_v2` **НЕ** триггерит notifications по умолчанию. Резиденту не нужен push-уведомление о каждом обновлении PDF с правилами.

**Исключение:** если УК хочет анонсировать документ — используется `announcements_v2` с ссылкой на документ в `body` (см. `announcements-v2-spec.md`). Это отдельная операция, требующая явного действия staff.

**Будущее (P1, не в scope Phase 5):** подписка «уведомлять меня при обновлении категории `legal`» для резидента — feature-flag `documents.change_notifications`.

---

## 7. Open questions (резолюции)

**Q1. Хранить контент в БД или в object storage?**
A: `body_md` — в БД (короткие тексты, удобно full-text индексировать позже). Файлы (`file_url`) — в `/uploads/` (локальное хранилище через signed-URL). S3-совместимое хранилище — post-launch (BACKLOG).

**Q2. Нужна ли таблица `document_versions` в v1?**
A: Да, сразу. Юристы и residents могут потребовать «дайте мне правила в редакции на 2025-03-01». Без версионирования ответ невозможен. Стоимость — одна extra-таблица, одна лишняя INSERT при PATCH — приемлема.

**Q3. Кто контролирует `sort_order`?**
A: Staff (`property_admin`/`concierge`). UI — drag-and-drop с bulk-update endpoint `POST /api/v1/documents/reorder { category, ordered_ids: [] }`. Вложен в основной PATCH но через dedicated endpoint для атомарности.

**Q4. Что с category-enum расширением?**
A: В v1 — фиксированный enum из §2.1. Кастом — через `tag`. Если клиенту нужна новая категория — это spec-change + миграция enum (миграция Postgres enum требует `ALTER TYPE ADD VALUE`, транзакция). Приемлемая цена за типобезопасность.

**Q5. Что с удалёнными (soft-deleted) документами в `document_versions`?**
A: Остаются. Удаление документа — пометка `deleted_at`, история сохраняется для аудита. Hard-delete документа — **запрещён**; только вручную DBA в случае GDPR-запроса.

**Q6. Rate-limit для public endpoint?**
A: 60 req/min per-IP. Public-API привлекает ботов — без лимита возможен abuse. Если легитимный трафик превысит — поднимем.

**Q7. Markdown extensions?**
A: CommonMark + GFM (tables, task-lists, strikethrough). Никаких raw-HTML inline (sanitizer вырезает). Никаких плагинов для embed-видео / iframe в v1. Спецификация sanitizer — ADR при имплементации.

---

## 8. Приложение — UX-примечание

Для резидента в личном кабинете документы группируются:
1. **«Важное»** — категория `safety` + `legal` (pinned, всегда сверху)
2. **«Правила и контакты»** — `rules` + `contacts`
3. **«Инструкции»** — `instructions`
4. **«Договоры»** — `contracts` (только для auth-резидента, не в public)
5. **«Остальное»** — `other`

Группировка — клиентская, не заложена в схему. Меняется UI-фичей без миграции.

На kiosk-режиме (см. legacy `?kiosk=1` в /api/documents) показываются только `is_public=true` — для терминала у входа.
