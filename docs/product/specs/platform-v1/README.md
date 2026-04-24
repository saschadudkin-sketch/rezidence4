# platform-v1 — Module Specs Index

Короткие спецификации (1–2 страницы каждая) для D-lite рефактора. Формат описан в `passes-spec.md §8`.

**Мастер-спека БД:** `../domhub-access-data-model-spec.md`
**Роадмап:** `/ROADMAP.md` в корне репо
**Reconciliation:** `/RECONCILIATION.md` в корне репо

## Готовые спеки (по фазам)

### Фаза 2 — Structure + People

| Модуль | Статус |
|---|---|
| [units](./units-spec.md) | Draft |
| [residents](./residents-spec.md) | Draft |
| [staff-users](./staff-users-spec.md) | Draft |
| [contractors](./contractors-spec.md) | Draft (covers `contractor_companies` + `contractor_users`) |
| [auth-v1](./auth-v1-spec.md) | Draft (§7: `requireAuthV1` middleware deferred до Phase 7) |

### Фаза 3 — Access-core

| Модуль | Статус |
|---|---|
| [passes](./passes-spec.md) | Draft (образец формата) |
| [vehicles](./vehicles-spec.md) | Draft |
| [access-requests](./access-requests-spec.md) | Draft |
| [visit-logs](./visit-logs-spec.md) | Draft |
| [access-incidents](./access-incidents-spec.md) | Draft (covers и `access_overrides`) |
| [qr-verification](./qr-verification-spec.md) | Draft (flow-spec: scan → verdict → log) |

### Фаза 4 — Frontend access-core

| Модуль | Статус |
|---|---|
| [frontend-phase4](./frontend-phase4-spec.md) | Draft (консолидированный план + acceptance) |

### Фаза 5 — Content + Notifications

| Модуль | Статус |
|---|---|
| [notifications-outbox](./notifications-outbox-spec.md) | Draft (инфра; пишется первой, её используют остальные модули Phase 5) |
| [notification-log-v2](./notification-log-v2-spec.md) | Draft (аудит-лог отправок; consumer outbox — см. §5 outbox) |
| [documents-v2](./documents-v2-spec.md) | Draft (body_md + категории + `document_versions`) |
| [packages-v2](./packages-v2-spec.md) | Draft (state machine + SLA-напоминания + fan-out через outbox) |
| [announcements-v2](./announcements-v2-spec.md) | Draft (audience-targeting + fan-out через outbox) |

### Фаза 6 — Legacy content migration

| Модуль | Статус |
|---|---|
| [notification-templates-v2](./notification-templates-v2-spec.md) | Draft (централизованное хранилище текстов уведомлений + mustache-lite rendering; P3 в Phase 6) |
| [legacy-utilities-freeze](./legacy-utilities-freeze-spec.md) | Draft (platform-level freeze-gate для meters/billing/bookings/chat до пост-релиза; P4 в Phase 6) |

**Фаза 5 не покрытая спеками (rename, делается миграцией без отдельного spec-файла):**
- `property_audit_log` — rename из legacy `audit_log` + `actor_type`/`entity_type`/`entity_id`. Миграция в `backend/src/v1/migrations/` при старте Phase 5, отдельный spec-файл не нужен.

## Спеки для следующих фаз (TODO)

Пишутся по мере подхода к соответствующей фазе. Создаются только для сущностей, которые мы реально строим в v1 — не пишем спеки «на будущее».

**Пост-релиз (не пишем сейчас):**
- `access-zones-spec.md`, `access-points-spec.md`, `access-policies-spec.md` — при появлении первого СКУД-контракта
- `meters-module-spec.md`, `billing-module-spec.md`, `bookings-module-spec.md`, `chat-module-spec.md` — после стабилизации access-core

## Правила

1. Спека пишется **до** PR с кодом. PR без обновлённой спеки — не мержится.
2. Если спека меняется в ходе реализации — обновляем spec-файл в том же PR.
3. Acceptance criteria из спеки = чек-лист для ревью.
4. Open questions (§7 шаблона) закрываются **в самой спеке** резолюцией, не в комментариях PR.
