# Module Spec - `access-policies` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Тикеты:** DH-13 Policy And Approval CRUD, DH-14 Policy Evaluation Engine
**Схема-база:** `../domhub-access-data-model-spec.md` section `access_policies`
**Связанные спеки:** `access-topology-spec.md`, `passes-spec.md`, `qr-verification-spec.md`

---

## 1. Назначение

`access_policies` описывает объектовые правила доступа: кто, каким методом, в какую зону или точку, в какое расписание может быть пропущен, и требуется ли согласование или решение охраны.

Политики не заменяют hard checks в `verifyPass`: invalid QR, blacklist, revoked/blocked/expired pass and outside pass window remain first. Policy evaluation runs only after the base pass/vehicle verdict is otherwise allowed.

---

## 2. Схема

```
access_policies
  id                UUID PK
  property_id       UUID NOT NULL
  name              VARCHAR(100) NOT NULL
  subject_type      ENUM(resident/guest/staff/contractor/contractor_user/vehicle/courier)
  subject_role      VARCHAR(30) NULL
  zone_id           UUID NULL -> access_zones(property_id, id)
  point_id          UUID NULL -> access_points(property_id, id)
  access_method     ENUM(qr/manual/plate/ble/card/face/pin)
  approval_mode     ENUM(auto/required/security_only/admin_only)
  effect            ENUM(allow/deny/needs_approval/needs_security_review/incident_required)
  priority          INTEGER NOT NULL DEFAULT 100
  schedule_json     JSONB NULL
  duration_minutes  INTEGER NULL
  is_recurring      BOOLEAN NOT NULL DEFAULT false
  is_active         BOOLEAN NOT NULL DEFAULT true
  created_by        UUID NULL
  metadata          JSONB NOT NULL DEFAULT '{}'
  created_at        TIMESTAMPTZ NOT NULL
  updated_at        TIMESTAMPTZ NOT NULL
```

Ordering is deterministic: lower `priority` wins, then `created_at`, then `id`.

---

## 3. API

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/v1/access-policies?property_id=&is_active=&subject_type=&zone_id=&point_id=` | security/concierge/admin | List policies |
| `GET` | `/api/v1/access-policies/:id` | security/concierge/admin | Policy details |
| `POST` | `/api/v1/access-policies` | property admin | Create policy |
| `PATCH` | `/api/v1/access-policies/:id` | property admin | Update policy |
| `POST` | `/api/v1/access-policies/:id/deactivate` | property admin | Soft deactivate |
| `POST` | `/api/v1/access-policies/evaluate` | security/admin | Deterministic dry-run with trace |
| `GET` | `/api/v1/access-policy-templates` | security/concierge/admin | Default template catalog |

---

## 4. Evaluation Rules

1. Base verification checks run first.
2. If base verdict is deny, policy engine does not override it.
3. If no active policies match the subject/method/scope, existing behavior remains allowed.
4. If a policy matches subject/method/scope but schedule does not match, the engine returns `deny` with `outside_policy_schedule`.
5. If a matching policy has `approval_mode != auto` and `effect=allow`, evaluation returns the corresponding approval/security review outcome.
6. Every non-fallback decision returns a trace entry with matched policy id, name, priority, effect, approval mode and reason.

Schedule baseline supports:
- `timezone`, default `Europe/Moscow`;
- `days_of_week`, values `0..6` where `0` is Sunday;
- `time_windows`, array of `{ "start": "HH:mm", "end": "HH:mm" }`.

---

## 5. Acceptance Criteria

- [ ] Migration creates `access_policies` with property scope, enums, JSON schedule, priority and active indexes.
- [ ] Policy CRUD is property-scoped and writes audit entries.
- [ ] Default templates exist for resident vehicle, guest vehicle, courier, contractor/service, staff operational and emergency access.
- [ ] Evaluation is deterministic and returns allow/deny/approval/security-review decisions with trace.
- [ ] `verifyPass` applies policy only after base hard checks and preserves old behavior when no active policy matches.
- [ ] Policy deny/review verdicts are visible in verify API response and audit trail.

---

## 6. Out Of Scope

- Visual policy builder UI.
- Vendor SKUD policy synchronization.
- Offline guard policy cache.
- Full legal sign-off for Russia-specific policy wording.
