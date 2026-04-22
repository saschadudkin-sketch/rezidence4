# Module Spec — `residents` (platform-v1)

**Фаза:** 2 (People layer)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.2
**Миграция:** `backend/src/v1/migrations/004_residents.sql`

---

## 1. Назначение

`residents` — жители объекта (собственники, арендаторы, члены семьи), привязанные к конкретной `unit`. Создание заявок на доступ, получение QR-пропусков, получение уведомлений — всё идёт через `resident_id`.

В legacy-коде все роли (житель, охрана, консьерж, техник, админ) слиты в одну таблицу `users` с `role TEXT`. В platform-v1 мы разделяем:
- `residents` — жители
- `staff_users` — персонал УК (см. отдельную спеку в Фазе 2)
- `contractor_users` — сотрудники подрядчиков (см. отдельную спеку)

**Почему раздельно:**
- Разные lifecycle: у резидента есть `unit_id` и `resident_type` (owner/tenant/family); у staff — `can_view_resident_phone` и другие capability-флаги; у contractor — `access_expires_at` и FK на `contractor_company_id`.
- Разный consent: резидент даёт согласие на обработку ПДн как физлицо; staff — через трудовой договор; contractor — через договор с компанией.
- Разные права: смешивать их через single-column `role` создаёт баги безопасности (мы уже видели это в legacy — guard может читать поля, зарезервированные для админа).

---

## 2. Схема

```
residents
  id                UUID PK
  external_uid      TEXT UNIQUE NULL       (legacy users.uid если мигрирован)
  property_id       UUID NOT NULL
  unit_id           UUID NOT NULL → units
  full_name         TEXT NOT NULL
  phone             TEXT NOT NULL
  email             TEXT NULL
  role              VARCHAR(20) DEFAULT 'resident'   (зарезервировано под future sub-roles)
  resident_type     ENUM(owner/tenant/family_member) DEFAULT 'owner'
  is_active         BOOLEAN DEFAULT true
  consent_given_at  TIMESTAMPTZ NULL
  consent_version   VARCHAR(20) NULL
  created_at / updated_at
```

Индексы: `(property_id, unit_id)`, `phone`, `is_active`.

**Note:** `phone` НЕ уникальный — один номер может быть привязан к разным residents на разных property (один человек живёт в Замоскворечье и владеет квартирой в будущем коттеджном посёлке).

---

## 3. State (неформально)

```
  created  ──► active (is_active=true)
  active   ──► inactive (is_active=false)   // выселение
  inactive ──► active                        // возврат
  
  consent_given_at=NULL ──► consent-required banner в UI, лимитирование операций
  consent_given_at=set  ──► полный доступ к фичам
```

ФЗ-152: при `is_active=false` более 3 лет — автоудаление через `privacy_deletion_requests` (runtime уже есть в legacy).

---

## 4. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/residents?unit_id=&q=&is_active=` | `staff` (с `can_view_resident_phone`) | Список с фильтрами; phone скрыт для security без capability |
| `GET` | `/api/v1/residents/:id` | self + `staff` | Детали |
| `POST` | `/api/v1/residents` | `property_admin` | Создать (при заселении) |
| `PATCH` | `/api/v1/residents/:id` | self (ограниченно) + `property_admin` | Обновить имя/email |
| `POST` | `/api/v1/residents/:id/deactivate` | `property_admin` | Soft-delete |
| `POST` | `/api/v1/residents/import` | `property_admin` | Bulk CSV (initial onboarding) |
| `POST` | `/api/v1/residents/:id/consent` | self | Принять ПДн-согласие (пишет `consent_given_at` + `consent_version`) |

Все PII-поля (phone, email, full_name) логируются в `property_audit_log` при чтении не-владельцем.

---

## 5. Миграция из legacy

| Legacy `users` | v1 `residents` | Правило |
|---|---|---|
| `uid` | `external_uid` | Копируется as-is |
| `phone, name` | `phone, full_name` | 1:1 |
| `apartment` | `unit_id` | через parsing → `units` (см. units-spec §4) |
| `role='resident'` | попадает в `residents` | Остальные роли → в `staff_users` или `contractor_users` |
| `consent_accepted_at`, `consent_version` | `consent_given_at`, `consent_version` | 1:1 |
| `anonymized_at`, `deleted_at` | `is_active=false` + запись в `privacy_deletion_requests` | |
| `avatar`, `property_slug` | не переносим | `property_slug` избыточно (tenant DB уже scoped) |

Миграция в Фазе 7. До этого legacy `users` остаётся источником правды для auth.

---

## 6. Acceptance criteria

- [ ] Миграция `004_residents.sql` применяется
- [ ] FK `unit_id` enforce'ится; нельзя создать резидента без существующего unit
- [ ] API-endpoints покрыты тестами; capability-фильтрация `can_view_resident_phone` протестирована
- [ ] CSV-import валидирует телефоны (формат E.164) и возвращает per-row errors
- [ ] Consent-endpoint пишет в `property_audit_log` с `action='resident.consent_given'`

---

## 7. Открытые вопросы

1. **Auth в v1 — где JWT claims?** → **Решено в отдельной спеке `auth-v1-spec.md` (Фаза 2):** JWT claim включает `subject_type: 'resident'|'staff'|'contractor'` + `subject_id`. `residents.id` становится subject_id для резидентов.
2. **Несколько квартир у одного резидента (owner двух квартир)** → **Не в v1.** Moделируется через 2 строки `residents` с одинаковым phone/email — overhead приемлем. Полная модель (через join-table) — пост-релиз.
3. **Family member без своего телефона** → **Разрешаем:** `phone` NOT NULL, но в таком случае ставится phone родителя с пометкой в `external_uid`. Кастомное поведение UI.
