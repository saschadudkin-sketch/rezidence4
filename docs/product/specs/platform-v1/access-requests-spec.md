# Module Spec — `access_requests` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Схема-база:** `docs/product/specs/domhub-access-data-model-spec.md` §5.5
**Миграция:** `backend/src/v1/migrations/009_access_requests.sql` + `010_access_approvals.sql`
**Product alignment:** `docs/product/specs/domhub-access-competitive-improvement-plan.md`

---

## 1. Назначение

`access_requests` — формальная заявка на доступ: кто-то (резидент, staff, contractor) просит пропустить кого-то (гостя, авто, подрядчика, курьера) в указанный временной слот, опционально — в конкретную зону/точку.

В legacy-коде заявка — это монолит `requests`, который **смешивает access и service**:
- access-типы: `pass`, `car`, `move_in`, `move_out`
- service-типы: `repair`, `cleaning`, `complaint`, `suggestion`, `tech`, `concierge`

Монолит создаёт три проблемы:
- Разная бизнес-логика (access требует QR, service — назначения исполнителя) в одном роуте
- `status TEXT` без enum-check — накопились 14 разных значений, часть зависла в проде
- Нельзя эволюционировать access-модель (нужен `approval_required`, `target_zone_id`, `vehicle_id`) без risk для service-логики

**В platform-v1 мы разделяем:**
- `access_requests` — этот документ
- `service_requests` — отдельная спека (Фаза 6); для ЖКХ-заявок
- Связь через `request_access_links` (Фаза 6): service-request может породить access-request (сантехник едет → нужен пропуск на авто)

### 1.1 Product Vocabulary And Canonical Contracts

Эта спека участвует в Phase 0 alignment из `domhub-access-competitive-improvement-plan.md`.

Canonical contract:
- Новые access UX flows используют `/api/v1/access-requests` как source of truth.
- Deprecated `/api/*` и legacy `requests` aliases остаются только compatibility/shim surface до миграции.
- Resident-facing creation UX должен оперировать продуктовым словарём: guest, courier, service, vehicle, trusted visitor / frequent guest.

Stable product fields:
- `guest_instructions` — текст для гостя на публичной странице пропуска.
- `guard_notes` — staff/security-only заметка для решения на КПП.
- `share_delivery_channels` — будущая настройка каналов доставки ссылки/QR.

Эти поля реализованы как отдельные колонки в `v1_051_access_request_product_text`.
`metadata` допустима только для экспериментальных или integration-only расширений.

Out of scope for this module:
- PIN/fallback credential хранится не в `access_requests`, а в credential layer для `passes`.
- Wallet/BLE/face recognition не входят в v1 access-request flow без отдельного approval.

---

## 2. Схема

```
access_requests
  id                              UUID PK
  property_id                     UUID NOT NULL
  created_by_type                 ENUM(resident/staff/contractor) NOT NULL
  created_by_resident_id          UUID NULL → residents
  created_by_staff_id             UUID NULL → staff_users
  created_by_contractor_user_id   UUID NULL → contractor_users
  request_type                    ENUM(guest_access/vehicle_access/contractor_access/courier_access/service_access/temporary_resident_access) NOT NULL
  visitor_name                    TEXT NULL
  visitor_phone                   TEXT NULL
  vehicle_id                      UUID NULL → vehicles
  target_zone_id                  UUID NULL → access_zones
  target_point_id                 UUID NULL → access_points
  target_unit_id                  UUID NULL → units
  reason                          TEXT NULL
  guest_instructions              TEXT NULL
  guard_notes                     TEXT NULL
  share_delivery_channels         JSONB NOT NULL DEFAULT []
  starts_at                       TIMESTAMPTZ NOT NULL
  ends_at                         TIMESTAMPTZ NOT NULL
  status                          ENUM(new/pending_approval/approved/rejected/cancelled/expired) DEFAULT 'new'
  approval_required               BOOLEAN DEFAULT true
  approved_at / rejected_at / cancelled_at
  created_at

access_approvals
  id                      UUID PK
  access_request_id       UUID NOT NULL → access_requests
  approver_type           ENUM(resident/staff) NOT NULL
  approver_staff_id       UUID NULL
  approver_resident_id    UUID NULL      (для co-approval в семье в будущем)
  decision                ENUM(approved/rejected/escalated) NOT NULL
  comment                 TEXT NULL
  created_at
```

Индексы: `access_requests(property_id, status)`, `(created_by_resident_id)`, `(target_zone_id)`, `(starts_at, ends_at)`.

---

## 3. State machine

```
   new
    │ submit()
    ▼
   pending_approval ── approval_required=false AND auto_policy ──► approved
    │                                                                    │
    │ staff.approve                                                      │
    ▼                                                                    │
   approved ◄───────────────────────────────────────────────────────────┘
    │ creates pass (см. passes-spec §3)
    │
    ▼
   passes issued — lifecycle переходит в `passes.status`
   
   (pending_approval|approved) ── requester.cancel ──► cancelled
   (pending_approval)           ── staff.reject    ──► rejected
   (approved|pending_approval)  ── now > ends_at   ──► expired
```

Инварианты:
- `approved` без записи в `access_approvals` разрешён только если `approval_required=false`
- Nullable `target_zone_id/target_point_id` в v1; если переданы, backend валидирует активные `access_zones`/`access_points` в том же property и pass наследует эти значения
- Cancel по истечении `ends_at` запрещён — переход в `expired` делает batch job

---

## 4. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/access-requests` | `resident`, `staff`, `contractor` | Создать заявку |
| `GET` | `/api/v1/access-requests?status=&created_by_resident_id=&request_type=` | `staff` + owner | Список |
| `GET` | `/api/v1/access-requests/:id` | creator + staff | Детали + approvals + linked pass |
| `POST` | `/api/v1/access-requests/:id/submit` | creator | Перевод `new → pending_approval` (если не авто-submit) |
| `POST` | `/api/v1/access-requests/:id/approve` | `property_admin`, delegated staff | Одобрить (создаёт `access_approval` + триггерит создание `pass`) |
| `POST` | `/api/v1/access-requests/:id/reject` | `property_admin`, delegated staff | Отклонить (`reason` обязателен) |
| `POST` | `/api/v1/access-requests/:id/cancel` | creator | Отменить свою заявку |
| `POST` | `/api/v1/access-requests/:id/escalate` | staff | Эскалация админу (decision='escalated') |

Все transitions пишут в `property_audit_log` с `entity_type='access_request'`.

---

## 5. Миграция из legacy

| Legacy `requests` | v1 | Правило |
|---|---|---|
| `type='pass'` | `access_requests(request_type='guest_access')` + `passes(pass_type='guest')` | |
| `type='car'` | `access_requests(request_type='vehicle_access', vehicle_id=...)` + `passes(pass_type='vehicle')` | |
| `type='move_in'/'move_out'` | `access_requests(request_type='temporary_resident_access')` | |
| `type='repair'/'cleaning'/'complaint'/'suggestion'/'tech'/'concierge'` | `service_requests` (отдельная v1-спека, Фаза 6) | Access-часть здесь не нужна |
| `status='new'/'in_progress'/'done'` → access | Маппинг: `new→new`, `in_progress→approved`, `done→approved` (with expired timestamp если истёк) | Анализ `status` истории legacy покажет точный маппинг |
| `request_history(req_id, by_name, by_role, label, at)` | `access_approvals` | Каждая строка с `label IN ('approved','rejected')` → запись в approvals |

Миграция в Фазе 7. До этого `/api/v1/requests` (legacy) продолжает работать параллельно с новым `/api/v1/access-requests` и `/api/v1/service-requests`.

---

## 6. Acceptance criteria

- [ ] Миграции `009` и `010` применяются
- [ ] Переход `approved → pass created` реализован транзакционно (либо оба, либо ни одного)
- [ ] Batch-job `expireOverdueRequests()` пишет в `property_audit_log` для каждой просроченной заявки
- [ ] Фильтры в `GET /access-requests` покрыты integration-тестами
- [ ] Попытка mutation на terminal state (`rejected/cancelled/expired`) возвращает `409 Conflict`
- [ ] Одобрение требует `access_approvals` row или явного `approval_required=false` (enforce в сервисе)
- [ ] `target_zone_id` / `target_point_id` валидируются через DH-06 topology и переносятся в созданный pass

---

## 7. Открытые вопросы

1. **Авто-approval:** v1 использует `access_policies` как источник решения. `approval_mode='auto'` может выпустить pass сразу только при matched allow-policy и выключенном `manual_access_approval`; `required`/`security_only`/`admin_only`, отсутствие policy или policy deny переводят flow в review/deny согласно policy engine. `contractor_access` должен быть связан с service request через `request_access_links`; resident-created `service_access` разрешён как обычный разовый сервисный визит.
2. **Multiple visitors на одной заявке:** 5 гостей резидента на ужин → **Не в v1.** Создаётся 5 заявок или одна с `visitor_name='Гости Ивановых (5 чел)'` + batch-issue QR. Полная multi-visitor модель — пост-релиз.
3. **Повторяющиеся заявки:** клининг каждый вторник → **Не в v1.** Повторяющиеся — через `access_policies.is_recurring` (пост-релиз). В v1 — создавать вручную каждый раз.
4. **Co-approval (муж+жена оба должны одобрить гостя):** `access_approvals.approver_resident_id` nullable оставляем schemaтически, но UX co-approval — пост-релиз.
