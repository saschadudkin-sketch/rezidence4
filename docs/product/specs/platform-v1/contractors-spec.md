# Module Spec — `contractor_companies` + `contractor_users` (platform-v1)

**Фаза:** 2 (People layer)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.2
**Миграции:** `backend/src/v1/migrations/006_contractor_companies.js` + `007_contractor_users.js`

---

## 1. Назначение

`contractor_companies` + `contractor_users` — компании-подрядчики и их сотрудники, получающие регулярный доступ к объекту. Курьеры службы доставки, клининговые бригады, ремонтные компании, flower delivery, etc.

**Почему две таблицы, а не слияние в `staff_users`:**
- У подрядчика есть компания-юрлицо с собственным договором и ответственностью. Пасс выписывается не человеку, а компании → а её представителю.
- У contractor-user есть `access_expires_at` — встроенный expiry пропуска, которого нет у staff.
- Биллинг/анализ «сколько заявок обрабатывает компания X» возможен только при явной связи `contractor_user → contractor_company`.

---

## 2. Схема

```
contractor_companies
  id              UUID PK
  property_id     UUID NOT NULL
  name            TEXT NOT NULL
  contact_name    TEXT NULL
  contact_phone   TEXT NULL
  contact_email   TEXT NULL
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()

contractor_users
  id                      UUID PK
  contractor_company_id   UUID NOT NULL → contractor_companies
  property_id             UUID NOT NULL
  full_name               TEXT NOT NULL
  phone                   TEXT NULL
  email                   TEXT NULL
  specialization          VARCHAR(30) NULL
  is_active               BOOLEAN NOT NULL DEFAULT true
  access_expires_at       TIMESTAMPTZ NULL
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Индексы:
- `contractor_companies(property_id, status)`
- `contractor_users(contractor_company_id)`
- `contractor_users(property_id, is_active)`

Enum `status` (на `contractor_companies`): `active`, `suspended`, `terminated`.

---

## 3. Lifecycle

**Компания:**
```
  active ──► suspended (временная блокировка — спор с УК)
  active ──► terminated (договор расторгнут, read-only)
  suspended ──► active
  terminated — конечное состояние
```

При `status != 'active'` — новые пропуски не выдаются; существующие активные passes не отзываются автоматически (это решение property_admin).

**Сотрудник:**
```
  is_active=true + access_expires_at IS NULL или > NOW() ──► может получать пассы
  access_expires_at < NOW() ──► пасс не выдаётся, existing passes истекают по своим срокам
  is_active=false ──► soft-delete, убран из UI
```

---

## 4. API

### Companies

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/contractor-companies?status=&q=` | `property_admin`, `concierge` | Список |
| `GET` | `/api/v1/contractor-companies/:id` | `property_admin`, `concierge` | Детали + сотрудники |
| `POST` | `/api/v1/contractor-companies` | `property_admin` | Создать |
| `PATCH` | `/api/v1/contractor-companies/:id` | `property_admin` | Обновить контакты/статус |

### Users

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/contractor-users?contractor_company_id=&is_active=` | `property_admin`, `concierge` | Список |
| `POST` | `/api/v1/contractor-users` | `property_admin` | Добавить сотрудника в компанию |
| `PATCH` | `/api/v1/contractor-users/:id` | `property_admin` | Обновить expires_at, specialization |
| `POST` | `/api/v1/contractor-users/:id/deactivate` | `property_admin` | Soft-delete |

Все mutations логируются. Создание `contractor_user` для `company.status!='active'` → 409.

---

## 5. Миграция из legacy

В текущем legacy подрядчиков как сущности нет — они создаются заявками-разовыми. Миграция — это заполнение справочника при onboarding:
1. Выписка регулярных подрядчиков из текущих пропусков
2. Группировка по phone/email → создание `contractor_companies`
3. Создание `contractor_users`

Это происходит в Фазе 7 вручную property-admin'ом через UI, не автоматически.

---

## 6. Acceptance criteria

- [ ] Миграции 006 + 007 применяются идемпотентно
- [ ] FK `contractor_company_id` enforce'ится
- [ ] Создание user в suspended/terminated компании → 409
- [ ] `access_expires_at` валидируется (> NOW() при создании)
- [ ] Soft-delete компании не удаляет users, но они становятся "frozen" (проверяется при выдаче пасса)
- [ ] Audit-log на все mutations

---

## 7. Открытые вопросы

1. **Мультизонный подрядчик** (одна клининговая компания для нескольких ЖК одной УК) → **Не в v1.** Один row per property. Будущий join-table `contractor_company_assignments` — пост-релиз.
2. **Контрактные документы** (скан договора) → **Не в v1.** Attachments идут в `documents_v2` в Фазе 5 с tag-связью.
3. **Автоматический expire при `access_expires_at`** → **Обеспечиваем в service-layer.** Nightly job помечает `is_active=false` при истечении; в v1 job не пишем, проверяем on-read.
