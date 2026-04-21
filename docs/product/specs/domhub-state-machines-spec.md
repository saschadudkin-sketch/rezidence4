# DomHub — State Machines Specification

Дата: 2026-04-21  
Статус: рабочая state-machine specification  
Назначение: формализовать жизненные циклы access, requests и incidents.

---

## 1. Цель документа

Документ фиксирует:
- какие состояния поддерживаются;
- какие переходы допустимы;
- кто имеет право на переход;
- какие side effects должны происходить при переходе.

Этот документ обязателен для:
- backend validation;
- API contract rules;
- frontend UI states;
- analytics and audit;
- notification triggers.

---

## 2. Access Request State Machine

### 2.1 Состояния `access_request.status`

- `new`
- `pending_approval`
- `approved`
- `rejected`
- `cancelled`
- `expired`

### 2.2 Разрешённые переходы

| From | To | Кто может | Комментарий |
|---|---|---|---|
| `new` | `pending_approval` | system / creator | если policy требует approval |
| `new` | `approved` | system | если policy auto-approves |
| `new` | `cancelled` | creator / admin | до активации |
| `pending_approval` | `approved` | approver | security/admin/resident per policy |
| `pending_approval` | `rejected` | approver | требуется reason/comment |
| `pending_approval` | `cancelled` | creator / admin | если request больше не нужен |
| `approved` | `expired` | system | по времени |
| `approved` | `cancelled` | admin / creator if allowed | если pass ещё не использован |
| `rejected` | `new` | никто | только создание нового request |
| `cancelled` | `new` | никто | только создание нового request |
| `expired` | `new` | никто | только создание нового request |

### 2.3 Side effects

- `new -> pending_approval`
  - создать approval task / event
  - отправить уведомление approver

- `new -> approved`
  - сгенерировать `pass`
  - если method = `qr`, создать `qr_pass`
  - отправить уведомление инициатору

- `pending_approval -> approved`
  - записать `access_approval`
  - сгенерировать `pass`
  - отправить уведомление инициатору и/или subject

- `pending_approval -> rejected`
  - записать `access_approval`
  - отправить уведомление инициатору

- `approved -> expired`
  - деактивировать pass
  - сгенерировать audit event

---

## 3. Pass State Machine

### 3.1 Состояния `pass.status`

- `active`
- `used`
- `expired`
- `revoked`
- `blocked`

### 3.2 Разрешённые переходы

| From | To | Кто может | Комментарий |
|---|---|---|---|
| `active` | `used` | system / guard console | для one-time flows |
| `active` | `expired` | system | по времени |
| `active` | `revoked` | admin / creator if allowed | требует reason |
| `active` | `blocked` | admin / security with rights | policy/security action |
| `used` | `blocked` | admin | если нужен retroactive block marker |
| `used` | `revoked` | admin | редко, для административного закрытия |
| `expired` | `active` | никто | только новый pass |
| `revoked` | `active` | никто | только новый pass |
| `blocked` | `active` | admin | только если policy разрешает реактивацию |

### 3.3 Side effects

- `active -> used`
  - создать `visit_log`
  - если pass one-time, дальнейшие попытки должны deny/incident

- `active -> revoked`
  - записать reason, actor
  - отправить уведомление инициатору/subject

- `active -> blocked`
  - создать audit event
  - optionally create incident

---

## 4. Visit Event State Logic

`visit_log` сам по себе append-only и не имеет lifecycle, но типы событий должны быть валидны.

Поддерживаются:
- `entry_allowed`
- `entry_denied`
- `exit_allowed`
- `exit_denied`
- `manual_admit`
- `manual_deny`
- `override`

### Правило

`visit_log` не редактируется post-factum, кроме административной корректировки с отдельным audit trail.

---

## 5. Access Incident State Machine

### 5.1 Состояния `access_incident.status`

- `open`
- `investigating`
- `resolved`
- `dismissed`

### 5.2 Разрешённые переходы

| From | To | Кто может | Комментарий |
|---|---|---|---|
| `open` | `investigating` | security / admin | инцидент взят в работу |
| `open` | `resolved` | security / admin | если решение очевидно |
| `open` | `dismissed` | admin / security with rights | ложное срабатывание |
| `investigating` | `resolved` | security / admin | решение найдено |
| `investigating` | `dismissed` | admin | инцидент признан несущественным |
| `resolved` | `investigating` | admin | reopen if needed |
| `dismissed` | `investigating` | admin | reopen if needed |

### 5.3 Side effects

- `open -> investigating`
  - назначить owner/assignee
  - уведомить ответственного при необходимости

- `open/investigating -> resolved`
  - зафиксировать resolution note
  - закрыть связанные temporary actions if needed

- `open/investigating -> dismissed`
  - зафиксировать reason
  - сохранить trail of who dismissed

---

## 6. Access Override State Logic

`access_override` — append-only action record.

Поддерживаемые `override_type`:
- `manual_admit`
- `manual_deny`
- `temporary_whitelist`
- `temporary_block`

### Правила

- override нельзя редактировать silently;
- каждый override должен иметь actor, reason, timestamp;
- override может создавать или связываться с incident;
- override должен влиять на analytics separately from normal allow/deny.

---

## 7. Request State Machine

### 7.1 Состояния `request.status`

- `new`
- `triaged`
- `assigned`
- `in_progress`
- `waiting_resident`
- `waiting_parts`
- `waiting_contractor`
- `resolved`
- `completed`
- `cancelled`
- `rejected`

### 7.2 Разрешённые переходы

| From | To | Кто может | Комментарий |
|---|---|---|---|
| `new` | `triaged` | concierge / admin | первичный разбор |
| `new` | `assigned` | concierge / admin | сразу назначено |
| `new` | `rejected` | admin / concierge with rights | если вне scope |
| `new` | `cancelled` | resident / admin | отмена |
| `triaged` | `assigned` | concierge / admin | назначение исполнителя |
| `assigned` | `in_progress` | technician / contractor / admin | взято в работу |
| `in_progress` | `waiting_resident` | technician / admin | ждём действия жителя |
| `in_progress` | `waiting_parts` | technician / admin | ждём материалы |
| `in_progress` | `waiting_contractor` | admin / concierge | передача подрядчику |
| `in_progress` | `resolved` | technician / contractor / admin | работа выполнена |
| `waiting_resident` | `in_progress` | technician / admin | ответ получен |
| `waiting_parts` | `in_progress` | technician / admin | материалы получены |
| `waiting_contractor` | `assigned` | admin | подрядчик определён |
| `resolved` | `completed` | admin / system | финальное закрытие |
| `resolved` | `in_progress` | admin | reopen |
| `assigned` | `cancelled` | admin / resident if allowed | before work |
| `in_progress` | `cancelled` | admin only | exceptional |

### 7.3 Side effects

- assignment transitions:
  - set `assigned_to`, `assigned_at`
  - trigger notifications

- `assigned -> in_progress`
  - set `started_at`
  - trigger analytics event

- `in_progress -> resolved`
  - set `resolved_at`
  - require `resolution_note` if configured

- `resolved -> completed`
  - set `completed_at`
  - open rating flow for resident

---

## 8. Contractor Access Linked State Logic

Contractor-related access should follow both request and access lifecycles.

### Minimum linked rule

Если request требует contractor access:
- request cannot be considered operationally valid until linked access exists or explicit exception is recorded;
- contractor access expiration should not outlive related work without administrative reason.

---

## 9. Notification trigger map

Уведомления обязательно должны уходить на переходах:

### Access
- `access_request -> pending_approval`
- `access_request -> approved`
- `access_request -> rejected`
- `pass -> revoked`
- `incident -> open` for critical types

### Requests
- `request -> assigned`
- `request -> waiting_resident`
- `request -> resolved`
- `request -> completed`

---

## 10. Analytics trigger map

События для аналитики должны возникать на:
- request created
- request assigned
- request started
- request resolved
- request completed
- access request created
- access approved
- access denied
- pass used
- override performed
- incident created
- incident resolved

---

## 11. Validation rules

### Mandatory validation

- запрещены skip transitions;
- каждый terminal transition должен иметь reason if rejected/cancelled/dismissed;
- actor должен соответствовать permission model;
- transitions must be property-scoped;
- expired states cannot be reactivated except through explicit admin-only rules defined elsewhere.

---

## 12. Следующий документ

Следующий документ:
- `domhub-access-api-contract-spec.md`

Он должен зафиксировать:
- какие endpoints двигают каждую state machine;
- какие payloads требуются;
- какие role/scope ограничения проверяются;
- какие ошибки возвращаются при недопустимом переходе.

