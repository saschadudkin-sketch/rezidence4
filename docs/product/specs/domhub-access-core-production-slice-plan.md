# DomHub Access-Core Production Slice Plan

Status: working execution plan
Date: 2026-05-03
Scope: `rezidence4` platform-v1 access-core stabilization and cutover

## Core Rule

Do not expand product scope until access-core is a proven production slice:

```text
resident creates access request
-> staff/security processes it
-> pass, QR, and plate verification work
-> visit log, incident, and audit are written
-> full e2e passes in strict gate
```

The immediate goal is proof, not breadth.

## Current Priority Order

1. Access identity mapping blocker
2. Restore/fresh-install drift
3. Full `/v1/access` production e2e
4. CI strict gate cleanup
5. Service refactor
6. Role/scope model
7. Frontend cutover
8. Legacy freeze
9. Policy engine
10. Pilot readiness

## Phase 0. Project Base Unblock

### 0.1 Close The Identity Mapping Blocker

Problem: legacy `req.user.uid` is still used in places as if it were the UUID primary key from v1 tables. This is unsafe for `residents.id`, `staff_users.id`, `contractor_users.id`, `passes`, `vehicles`, `visits`, and `access_incidents`.

Work:

1. Create `AccessActorResolver`.
2. Resolve legacy identity into v1 actor IDs:
   - `users.uid` -> `residents.id`
   - `users.uid` -> `staff_users.id`
   - `users.uid` -> `contractor_users.id`
3. Apply resolver in:
   - `accessRequests`
   - `passes`
   - `vehicles`
   - `visits`
   - `accessIncidents`
4. Remove direct writes of `req.user.uid` into v1 UUID foreign keys.
5. Add tests:
   - happy path resident
   - happy path staff/security
   - missing resident mapping
   - missing staff mapping
   - contractor ambiguity
   - forbidden cross-role access

Exit criteria:

- No v1 FK receives legacy `uid` directly.
- All access-core mutations use `AccessActorResolver`.
- Backend tests are green.

### 0.2 Fix Restore/Fresh-Install Drift

Problem: `restore-drill.sh` checks `v1_property_migrations`, but real v1 migrations are tracked in shared `schema_migrations` with `v1_*` IDs.

Replace:

```sql
SELECT COUNT(*) FROM v1_property_migrations
```

with:

```sql
SELECT COUNT(*) FROM schema_migrations WHERE id LIKE 'v1_%'
```

Update:

- `scripts/restore-drill.sh`
- `docs/runbooks/restore-drill.md`
- any checklist or runbook references to `v1_property_migrations`

Exit criteria:

- Empty DB -> migrations -> seed/import minimal data -> backend start.
- Restore drill does not reference a non-existent table.
- Restore drill sees the current v1 migrations through `schema_migrations`.

### 0.3 Return CI To A Strict Gate

Problem: `verify` checks backend tests, frontend lint, typecheck, frontend tests, and build, but Playwright e2e is not part of the local strict profile.

Work:

1. Add a strict profile, for example:

```json
"verify:strict": "node scripts/run-checks.cjs verify && npm run test:e2e"
```

or include e2e directly in `verify` once the project is ready to carry it as a mandatory gate.

2. Remove stale advisory comments about migration 011 after fresh migration is confirmed.
3. Make full e2e a blocking verdict, not advisory.

Exit criteria:

- `npm run verify:strict` fails when e2e fails.
- CI cannot pass without browser proof for access-core.
- Full e2e passes several consecutive runs.

## Phase 1. Access-Core Production Slice

Goal: prove one complete access workflow end to end.

### 1.1 Resident Access Request Flow

Scenario:

1. Resident creates access request.
2. Staff/security sees the request.
3. Staff/security can:
   - approve
   - reject
   - escalate
4. Approve creates a pass.
5. Pass is linked to:
   - resident
   - request
   - vehicle, for vehicle access
   - property

Tests:

- resident create request
- staff approve
- staff reject
- security escalate
- invalid status transition
- forbidden resident approving own request
- missing identity mapping

### 1.2 QR Flow

Scenario:

1. Resident receives QR for pass.
2. Security scans QR through `/api/v1/visits/verify`.
3. `visit_logs_v2` row is created.
4. One-shot pass becomes `used` if product policy requires it.

Tests:

- valid QR allow
- invalid QR deny
- expired pass deny
- revoked pass deny
- blocked pass deny
- repeated QR attempt
- one-shot pass used transition
- visit log created
- incident created where required

### 1.3 Plate Flow

Scenario:

1. Security enters plate or camera sends plate.
2. Backend finds vehicle.
3. Whitelist/blacklist is evaluated.
4. Visit log is created.
5. Deny creates incident where required.

Tests:

- known allowed plate
- unknown plate deny
- blacklisted plate deny
- whitelisted plate allow
- unauthorized resident vehicle deny
- plate normalization
- visit log on allow
- incident on deny

### 1.4 Incidents And Audit

Work:

1. Deny events create incidents where required.
2. Override writes append-only audit.
3. Audit is tenant-scoped.
4. Audit write does not break the main flow, but failures are logged.

Tests:

- deny creates incident
- override creates audit trail
- audit has actor
- audit has role
- audit has property context
- audit is append-only
- cross-tenant audit leakage is impossible

### 1.5 Production E2E

Add Playwright e2e:

```text
resident login
-> create access request
-> staff login
-> approve request
-> resident sees pass
-> resident opens QR
-> security login
-> verify QR
-> visit log visible
-> incident/audit visible where applicable
```

Add separate smoke/e2e coverage:

- deny QR
- expired pass
- blocked pass
- plate deny
- plate allow

Exit criteria for Phase 1:

- At least one full browser e2e exists for `/v1/access`.
- QR, plate, deny, incident, and audit are covered by backend tests.
- Strict CI gate is green.
- Access-core can be demonstrated as a production slice.

## Phase 2. Backend Refactor V1

Start only after Phases 0 and 1.

### 2.1 Extract Business Logic From Routes

Create services:

1. `AccessActorResolver`
2. `PropertyAuditService`
3. `AccessRequestService`
4. `PassService`
5. `VehicleService`
6. `VisitVerificationService`
7. `AccessIncidentService`

Routes should keep only:

- auth
- validation
- service call
- response mapping

### 2.2 State Machine

Describe and test transitions.

Access request:

```text
pending -> approved
pending -> rejected
pending -> escalated
escalated -> approved
escalated -> rejected
```

Pass:

```text
active -> used
active -> revoked
active -> blocked
blocked -> active
active -> expired
```

Forbid invalid transitions:

```text
revoked -> active
expired -> active
used -> active
rejected -> approved
```

Exit criteria for Phase 2:

- Routes do not contain complex SQL transactions.
- State transitions are covered by service tests.
- API contract does not change without OpenAPI/spec update.
- Negative permission tests are green.

## Phase 3. Role / Scope Model

### 3.1 Final Roles

- `resident`
- `security`
- `concierge`
- `technician`
- `contractor`
- `property_admin`
- `management_company_admin`
- `platform_admin`

### 3.2 Compatibility Mapping

Legacy mapping:

```text
owner      -> resident
tenant     -> resident
admin      -> property_admin
security   -> security
contractor -> contractor or contractor_user
```

The `contractor` mapping needs a separate decision. It is not resident-like; it should become a distinct contractor identity.

### 3.3 Scope Model

Add access levels:

- property
- building
- entrance
- floor
- unit
- parking zone
- access zone
- access point

### 3.4 Authz Catalog

Capabilities:

```text
access.request.create
access.request.approve
access.request.reject
access.pass.read
access.pass.revoke
access.pass.block
access.qr.verify
access.plate.verify
access.incident.create
access.incident.resolve
access.override.create
audit.read
```

Exit criteria for Phase 3:

- Every role has explicit capabilities.
- Business logic has no `role === 'admin'` checks.
- Negative permission tests cover each role.
- Frontend role gates match backend authz.

## Phase 4. V1 Frontend Cutover

### 4.1 Access Work Only In `/v1/*`

Do not expand legacy dashboard with new access features.

### 4.2 Resident UI

Build or stabilize:

- `/v1/access`
- my requests
- my passes
- QR
- my vehicles
- apartment vehicle list
- parking space numbers
- visit history

### 4.3 Security UI

Build or stabilize:

- guard console
- QR scan
- plate lookup
- deny reason
- manual incident
- override flow
- recent visits
- suspicious attempts

### 4.4 Concierge/Admin UI

Build or stabilize:

- access requests
- residents
- units
- vehicles
- parking spaces
- contractors
- incidents
- packages
- announcements
- documents

### 4.5 UX Smoke Suite

Add smoke/e2e for:

- resident access page loads
- staff request queue loads
- security guard console loads
- QR scan happy path
- plate deny path
- incident list visible

Exit criteria for Phase 4:

- `/v1/access` covers the main user workflow.
- Legacy access UI no longer grows.
- Frontend smoke suite is green.

## Phase 5. Legacy Freeze

### 5.1 Legacy Retirement Map

| Legacy module | V1 replacement | Status |
| --- | --- | --- |
| requests | access-requests + passes | v1 shadow / v1 primary |
| visit-logs | visits | v1 shadow |
| packages | packages_v2 | v1 primary |
| documents | documents_v2 | v1 primary |
| announcements | announcements_v2 | v1 primary |
| meters | TBD | legacy active |
| billing | TBD | legacy active |
| bookings | TBD | legacy active |
| chat | TBD | legacy active |

### 5.2 Migration Statuses

Use one status set:

```text
legacy active
v1 shadow
v1 primary
legacy read-only
legacy removed
```

### 5.3 Freeze Legacy Modules

Freeze expansion in:

- meters
- billing
- bookings
- chat
- old packages
- old documents
- old announcements
- old requests

Exit criteria for Phase 5:

- It is clear what remains legacy.
- It is clear what is already v1 primary.
- No new features are added to legacy access flow.
- Fallback routes are removed only after proven cutover.

## Phase 6. Policy Engine

Start only after stable access-core.

### 6.1 Core Entities

Add:

- access zones
- access points
- access policies
- schedules
- exception rules
- temporary restrictions

### 6.2 Decision Cascade

Use one decision result model:

```text
allowed
denied
needs_approval
needs_security_review
manual_override_required
```

### 6.3 Connect Policies To Access-Core

Policies must affect:

- passes
- vehicles
- contractors
- residents
- guests
- guard console
- QR verification
- plate verification

### 6.4 SKUD Comes After Policy

Start real SKUD integrations only after the internal policy model is stable.

Exit criteria for Phase 6:

- All allow/deny decisions go through policy engine.
- Policy decision has audit trail.
- Conflicting rules have tests.
- Guard console shows deny reason.

## Phase 7. Pilot Readiness

### 7.1 One Pilot Tenant

Pick one property and avoid spreading scope.

Verify:

- residents
- units
- vehicles
- parking spaces
- staff
- security users
- contractors
- access requests
- passes
- incidents
- audit

### 7.2 Operational Readiness

Run:

1. backup drill
2. restore drill
3. fresh-install smoke
4. tenant isolation check
5. notification outbox retry/dead-letter check
6. audit completeness check
7. go-live smoke

### 7.3 Go-Live Checklist

Before pilot, all must be green:

- backend tests
- frontend tests
- lint
- typecheck
- build
- Playwright e2e
- restore drill
- access-core smoke
- tenant isolation smoke

Exit criteria for Phase 7:

- One tenant is ready for pilot.
- Rollback/runbook exists.
- Restore proof exists.
- E2E proof exists.
- Audit proof exists.
- Limited pilot can start.

## Planning Guardrail

First prove one working access-core flow. Then expand the product.
