---
description: Показать статус текущей фазы platform-v1 — что сделано, что осталось.
---

Собери и выведи краткий status-report по platform-v1 фазам.

1. Прочитай `docs/product/specs/platform-v1/README.md` — там overview всех фаз со статусами.
2. Прочитай последние 30 коммитов текущей ветки: `git log --oneline -30`.
3. Сопоставь: какие модули из README упомянуты в recent commits → **Implemented**.
4. Какие модули ещё в статусе **Ready** или **Draft** и не закоммичены → **Pending**.
5. Выведи краткую таблицу вида:

```
Фаза | Модуль                     | Статус      | Commit/TODO
-----+----------------------------+-------------+--------------
  5  | announcements_v2           | Implemented | 660a39a
  5  | documents_v2               | Implemented | eea868f
  5  | notifications-outbox       | Implemented | 47c8c22
  5  | property_audit_log rename  | Pending     | TODO
  5  | notifications.outbox flag  | Pending     | TODO
```

6. В конце — секция **Suggested next**: 1–3 следующих логичных шага (на основе Pending + IMPLEMENTATION_ORDER.md).

Отчёт — по-русски, кратко, без болтовни.
