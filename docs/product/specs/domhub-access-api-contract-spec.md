# DomHub — Access API Contract Specification

Дата: 2026-04-21  
Статус: рабочая API contract specification  
Назначение: зафиксировать базовые API контракты для DomHub access-platform.

---

## 1. Цель документа

Документ определяет:
- основные REST endpoints для access-domain;
- кто может вызывать endpoint;
- какой auth context требуется;
- какой минимальный request/response shape ожидается;
- какие типовые ошибки возвращаются.

Это не финальный OpenAPI, а контрактный каркас для backend/frontend design.

---

## 2. Общие правила API

### Prefix

Все продуктовые endpoints:
- `/api/v1/*`

Platform-level endpoints:
- `/platform/api/v1/*`

### Auth contexts

- `resident_session`
- `staff_session`
- `management_company_admin_session`
- `platform_admin_session`
- `public_no_auth`

### Общие ошибки

- `400 Bad Request` — invalid payload / missing required fields
- `401 Unauthorized` — no session / invalid auth
- `403 Forbidden` — role/scope violation
- `404 Not Found` — entity not found in tenant context
- `409 Conflict` — invalid state transition / stale state
- `422 Unprocessable Entity` — policy violation / validation semantic failure

---

## 3. Resident access endpoints

## 3.1 Create access request

`POST /api/v1/access-requests`

### Auth
- `resident_session`
- `staff_session` for concierge/admin creation on behalf of resident

### Request

```json
{
  "property_id": "uuid",
  "request_type": "guest_access",
  "visitor_name": "Иван Петров",
  "visitor_phone": "+79990000000",
  "vehicle_id": null,
  "target_zone_id": "uuid",
  "target_point_id": null,
  "target_unit_id": "uuid",
  "reason": "Гость",
  "starts_at": "2026-04-21T12:00:00Z",
  "ends_at": "2026-04-21T18:00:00Z"
}
```

### Response

```json
{
  "access_request": {
    "id": "uuid",
    "status": "pending_approval",
    "approval_required": true,
    "created_at": "2026-04-21T09:00:00Z"
  },
  "pass": null
}
```

### Errors
- `422` if request violates policy
- `403` if actor cannot create access for given scope

## 3.2 List own access requests

`GET /api/v1/access-requests`

### Auth
- `resident_session`
- `staff_session`

### Query
- `status`
- `from`
- `to`
- `requestType`

### Response

List of summarized access requests for actor scope.

## 3.3 Get access request detail

`GET /api/v1/access-requests/:id`

### Auth
- owner resident
- authorized staff

### Response

Detailed access request with approvals, linked pass, policy summary.

## 3.4 Cancel access request

`POST /api/v1/access-requests/:id/cancel`

### Auth
- creator resident if allowed
- authorized staff/admin

### Request

```json
{
  "reason": "Больше не требуется"
}
```

---

## 4. Approval endpoints

## 4.1 Approve access request

`POST /api/v1/access-requests/:id/approve`

### Auth
- `staff_session`
- `resident_session` only if policy allows resident-approval scenario

### Request

```json
{
  "comment": "Одобрено"
}
```

### Response

```json
{
  "access_request": {
    "id": "uuid",
    "status": "approved"
  },
  "pass": {
    "id": "uuid"
  }
}
```

## 4.2 Reject access request

`POST /api/v1/access-requests/:id/reject`

### Request

```json
{
  "comment": "Нет подтверждения"
}
```

### Errors
- `409` if request no longer approvable

---

## 5. Pass endpoints

## 5.1 List passes

`GET /api/v1/passes`

### Auth
- resident: own passes only
- staff: scoped property passes

### Query
- `status`
- `passType`
- `subjectType`
- `vehiclePlate`
- `from`
- `to`

## 5.2 Get pass detail

`GET /api/v1/passes/:id`

### Response

```json
{
  "id": "uuid",
  "status": "active",
  "pass_type": "guest",
  "valid_from": "2026-04-21T12:00:00Z",
  "valid_until": "2026-04-21T18:00:00Z",
  "qr": {
    "public_url": "https://example/pass/token"
  }
}
```

## 5.3 Revoke pass

`POST /api/v1/passes/:id/revoke`

### Auth
- resident if own and allowed
- staff/admin per role

### Request

```json
{
  "reason": "Отозван пользователем"
}
```

### Errors
- `409` if pass already terminal

## 5.4 Public QR pass view

`GET /api/v1/public/pass/:token`

### Auth
- `public_no_auth`

### Response

Public safe payload only:
- visitor label
- validity window
- QR representation metadata
- property display context if allowed

### Errors
- `404` token invalid
- `410` pass revoked/expired if policy prefers explicit gone

---

## 6. Vehicle endpoints

## 6.1 Create vehicle

`POST /api/v1/vehicles`

### Auth
- resident for own vehicle
- staff/admin for scoped vehicle registration

### Request

```json
{
  "plateNumber": "A123AA77",
  "vehicleType": "car",
  "brand": "Toyota",
  "model": "Camry",
  "color": "Black"
}
```

## 6.2 List vehicles

`GET /api/v1/vehicles`

### Auth
- resident own vehicles
- staff/admin scoped

## 6.3 Update vehicle flags

`PATCH /api/v1/vehicles/:id`

### Auth
- admin/security with rights

### Patchable fields
- `isWhitelisted`
- `isBlacklisted`
- `notes`

---

## 7. Security workspace endpoints

## 7.1 Security dashboard summary

`GET /api/v1/security/dashboard`

### Auth
- `security`
- `property_admin`

### Response

```json
{
  "expectedArrivals": 12,
  "activePasses": 37,
  "openIncidents": 3,
  "recentEvents": []
}
```

## 7.2 Search access subject

`GET /api/v1/security/search`

### Query
- `q`
- `type=person|vehicle|qr|unit`

### Response

Matched residents, passes, vehicles, recent events within scope.

## 7.3 Validate QR

`POST /api/v1/guard/scan-pass`

### Auth
- `security`
- `property_admin`

### Request

```json
{
  "token": "qr-token"
}
```

### Response

```json
{
  "decision": "allow",
  "passId": "uuid",
  "subjectLabel": "Иван Петров",
  "validUntil": "2026-04-21T18:00:00Z",
  "zone": "Main gate"
}
```

### Errors
- `422` policy violation
- `404` token unknown

## 7.4 Manual admit

`POST /api/v1/security/manual-admit`

### Request

```json
{
  "passId": "uuid",
  "reason": "Подтверждено охраной"
}
```

## 7.5 Manual deny

`POST /api/v1/security/manual-deny`

### Request

```json
{
  "passId": "uuid",
  "reason": "Нет подтверждения"
}
```

---

## 8. Incident endpoints

## 8.1 Create access incident

`POST /api/v1/access-incidents`

### Auth
- security
- property_admin
- system via internal service layer

### Request

```json
{
  "incidentType": "invalid_qr",
  "relatedPassId": "uuid",
  "relatedVisitLogId": null,
  "title": "Невалидный QR на КПП",
  "description": "Попытка прохода по токену, которого нет в системе"
}
```

## 8.2 List incidents

`GET /api/v1/access-incidents`

### Query
- `status`
- `severity`
- `incidentType`
- `assignedTo`

## 8.3 Update incident status

`POST /api/v1/access-incidents/:id/status`

### Request

```json
{
  "status": "investigating",
  "comment": "Передано старшему смены"
}
```

### Errors
- `409` invalid transition

## 8.4 Create override

`POST /api/v1/access-overrides`

### Auth
- security/property_admin with explicit permission

### Request

```json
{
  "incidentId": "uuid",
  "passId": "uuid",
  "overrideType": "manual_admit",
  "reason": "Технический сбой сканера"
}
```

---

## 9. Access topology and policy endpoints

## 9.1 List zones

`GET /api/v1/access-zones`

### Auth
- scoped staff/admin

## 9.2 Create zone

`POST /api/v1/access-zones`

### Auth
- property_admin

## 9.3 List points

`GET /api/v1/access-points`

## 9.4 Create point

`POST /api/v1/access-points`

### Auth
- property_admin

## 9.5 List policies

`GET /api/v1/access-policies`

### Auth
- property_admin
- management_company_admin aggregated if implemented through property scoping

## 9.6 Create policy

`POST /api/v1/access-policies`

### Request

```json
{
  "name": "Guest main gate QR",
  "subjectType": "guest",
  "zoneId": "uuid",
  "pointId": null,
  "accessMethod": "qr",
  "approvalMode": "required",
  "schedule": {
    "timezone": "Europe/Moscow",
    "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    "timeFrom": "00:00",
    "timeTo": "23:59"
  },
  "durationMinutes": 360,
  "isRecurring": false
}
```

## 9.7 Update / disable policy

`PATCH /api/v1/access-policies/:id`

---

## 10. Analytics endpoints

## 10.1 Property access overview

`GET /api/v1/analytics/access-overview`

### Auth
- property_admin
- scoped management_company_admin through property filter

### Query
- `from`
- `to`
- `propertyId` where applicable

### Metrics
- total access requests
- approvals
- rejections
- allowed events
- denied events
- open incidents
- overrides
- vehicle traffic

## 10.2 Security incidents analytics

`GET /api/v1/analytics/access-incidents`

## 10.3 Vehicle traffic analytics

`GET /api/v1/analytics/vehicle-traffic`

---

## 11. Management company endpoints

## 11.1 Portfolio access overview

`GET /platform/api/v1/access/overview`

### Auth
- management_company_admin
- platform_admin

### Response

Aggregated cross-property metrics without raw cross-tenant PII by default.

## 11.2 Portfolio incidents

`GET /platform/api/v1/access/incidents`

---

## 12. Platform admin endpoints

## 12.1 Property access health

`GET /platform/api/v1/access/property-health`

### Auth
- platform_admin

### Purpose

Platform-level operational view:
- integration health
- incident spikes
- notification health
- configuration anomalies

---

## 13. Role / scope enforcement rules

### Resident

- can create own access requests
- can see only own access requests/passes/vehicles
- cannot view raw incident queues

### Security

- can validate access
- can create incidents
- can manual admit/deny if allowed
- cannot change platform-level settings

### Concierge

- can create requests on behalf of resident if allowed
- can assist in approvals depending on policy
- usually not full guard override role

### Technician / Contractor

- can see only access linked to their work where policy allows
- cannot view unrelated resident access data

### Property Admin

- full object-level control over policies, incidents, audit visibility

### Management Company Admin

- cross-property aggregated visibility, not raw unrestricted PII by default

### Platform Admin

- platform governance, not routine object-level access operations

---

## 14. Required follow-up

После этого документа требуется финализировать:
- full OpenAPI schemas;
- exact request/response payloads;
- error catalog;
- concurrency rules for mutable endpoints;
- idempotency rules for critical operations.

