# platform-v1 — Module Specs Index

Короткие спецификации (1–2 страницы каждая) для D-lite рефактора. Формат описан в `passes-spec.md §8`.

**Мастер-спека БД:** `../domhub-access-data-model-spec.md`
**Роадмап:** `/ROADMAP.md` в корне репо
**Reconciliation:** `/RECONCILIATION.md` в корне репо

## Спеки Фазы 0 (готовы)

| Модуль | Фаза | Статус |
|---|---|---|
| [passes](./passes-spec.md) | 3 | Draft (образец формата) |
| [units](./units-spec.md) | 2 | Draft |
| [residents](./residents-spec.md) | 2 | Draft |
| [vehicles](./vehicles-spec.md) | 3 | Draft |
| [access-requests](./access-requests-spec.md) | 3 | Draft |
| [visit-logs](./visit-logs-spec.md) | 3 | Draft |
| [access-incidents](./access-incidents-spec.md) | 3 | Draft (покрывает и `access_overrides`) |
| [qr-verification](./qr-verification-spec.md) | 3 | Draft (flow-spec: scan → verdict → log) |

## Спеки для следующих фаз (TODO)

Пишутся по мере подхода к соответствующей фазе. Создаются только для сущностей, которые мы реально строим в v1 — не пишем спеки «на будущее».

**Фаза 2 (оставшиеся):**
- `staff-users-spec.md`
- `contractors-spec.md`
- `auth-v1-spec.md` (как меняется JWT при разделении users → residents/staff/contractors)

**Фаза 5:**
- `announcements-v2-spec.md`
- `documents-v2-spec.md`
- `notification-log-v2-spec.md`
- `packages-v2-spec.md`

**Пост-релиз (не пишем сейчас):**
- `access-zones-spec.md`, `access-points-spec.md`, `access-policies-spec.md` — при появлении первого СКУД-контракта
- `meters-module-spec.md`, `billing-module-spec.md`, `bookings-module-spec.md`, `chat-module-spec.md` — после стабилизации access-core

## Правила

1. Спека пишется **до** PR с кодом. PR без обновлённой спеки — не мержится.
2. Если спека меняется в ходе реализации — обновляем spec-файл в том же PR.
3. Acceptance criteria из спеки = чек-лист для ревью.
4. Open questions (§7 шаблона) закрываются **в самой спеке** резолюцией, не в комментариях PR.
