# Module Spec — `staff_users` (platform-v1)

**Фаза:** 2 (People layer)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.2
**Миграция:** `backend/src/v1/migrations/005_staff_users.js`

---

## 1. Назначение

`staff_users` — сотрудники объекта, работающие под управлением УК: охрана, консьержи, технические специалисты, property-admin. В отличие от резидентов, staff не привязан к конкретной `unit`, а имеет capability-флаги для тонкой настройки прав.

В legacy-коде охрана/консьерж/админ делили таблицу `users` через `role TEXT`. В v1 `staff_users` — отдельная таблица с собственными полями доступа и consent (через трудовой договор, не ПДн-согласие).

**Почему раздельно от residents:**
- Lifecycle не совпадает: у резидента есть `unit_id` и `consent_given_at` (ФЗ-152), у staff — capability-флаги, которые меняются при смене должности.
- Смешение в одной таблице создаёт implicit security bugs: guard видит поля property_admin, потому что фильтрация по `role` забыта в одном из роутов.
- Email обязателен (SSO-ready), phone опционален.

---

## 2. Схема

```
staff_users
  id                        UUID PK
  property_id               UUID NOT NULL
  full_name                 TEXT NOT NULL
  phone                     TEXT NULL
  email                     TEXT NOT NULL
  role                      VARCHAR(30) NOT NULL
  specialization            VARCHAR(30) NULL
  is_active                 BOOLEAN NOT NULL DEFAULT true
  can_view_resident_phone   BOOLEAN NOT NULL DEFAULT false
  can_assign_requests       BOOLEAN NOT NULL DEFAULT false
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Индексы: `(property_id, email) UNIQUE`, `role`.

Enum `role`: `security`, `concierge`, `technician`, `property_admin`.

Enum `specialization` (nullable): `plumbing`, `electric`, `cleaning`, `general` — используется только для `technician`; в других ролях игнорируется.

---

## 3. Capability-модель

Вместо иерархии «admin > concierge > guard» — **плоская роль + явные capability-флаги**:

| Роль | `can_view_resident_phone` default | `can_assign_requests` default |
|---|---|---|
| `security` | false | false |
| `concierge` | true | true |
| `technician` | false | false |
| `property_admin` | true | true |

Флаги можно переопределять индивидуально: например, старшему охраннику включить `can_view_resident_phone` без повышения роли. UI не прячет флаги от property-admin — он видит полную картину.

---

## 4. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/staff?role=&is_active=&q=` | `property_admin`, `concierge` | Список |
| `GET` | `/api/v1/staff/:id` | self + `property_admin` | Детали |
| `POST` | `/api/v1/staff` | `property_admin` | Создать (при найме) |
| `PATCH` | `/api/v1/staff/:id` | `property_admin` | Обновить роль/capability/поля |
| `POST` | `/api/v1/staff/:id/deactivate` | `property_admin` | Soft-delete при увольнении |

Все mutations пишут в `property_audit_log` с `entity_type='staff_user'`. Смена `role` или capability-флагов обязательно логируется с old/new значениями в `details`.

---

## 5. Миграция из legacy

| Legacy `users` | v1 `staff_users` | Правило |
|---|---|---|
| `role='guard'` | `role='security'` | переименование |
| `role='concierge'` | `role='concierge'` | 1:1 |
| `role='technician'` | `role='technician'` | 1:1; `specialization` — из отдельного поля/attribute |
| `role='admin'` | `role='property_admin'` | переименование |
| `role IN ('resident','owner')` | НЕ переносим | остаётся в `residents` |
| `email` → required | если в legacy пусто — генерируем placeholder `{phone}@staff.{slug}.local` | — |

Миграция в Фазе 7.

---

## 6. Acceptance criteria

- [ ] Миграция `005_staff_users.js` применяется идемпотентно
- [ ] UNIQUE на `(property_id, email)` enforce'ится; повторный email возвращает 409
- [ ] POST валидирует enum `role` и enum `specialization`
- [ ] POST выставляет default capability-флаги согласно роли
- [ ] PATCH логирует смену role/capability в audit с old/new
- [ ] Deactivate — soft-delete; hard-delete запрещён через API

---

## 7. Открытые вопросы

1. **Multi-property staff (один охранник работает на двух объектах УК)** → **Не в v1.** Один `staff_users` row per property. Один человек = несколько rows. Проблема ухудшения UX решается на уровне identity provider в пост-релизе.
2. **Смена property_admin без прерывания работы** → **Разрешаем множественных admin.** Нет уникального "owner" per property — все `property_admin` равны; смена = deactivate старого + create нового.
3. **Password/auth mechanism в v1** → см. `auth-v1-spec.md`. Staff логинятся по email + password; phone/SMS — только для резидентов.
