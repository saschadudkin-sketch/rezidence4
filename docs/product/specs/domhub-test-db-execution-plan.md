# DomHub — Test DB Execution Plan

Date: 2026-05-19
Last checked: 2026-05-20
Status: active execution plan while no real production database exists

This document defines the current DomHub execution plan while the project has
only a test database. It does not replace `domhub-final-product-plan.md`,
release gate checklists, or platform-v1 module specs. It narrows the next work
to a reproducible test contour that can later be connected to a real database
without changing the product architecture.

## 1. Current Operating Assumption

DomHub has no real production database yet. Therefore:

- "ready" means reproducible on a seeded test tenant, not production-validated;
- staging/prod restore evidence, 24/7 provider validation, field validation and
  external certification remain future evidence;
- release gates may validate scripts, contracts and local/runtime artifacts, but
  must not be described as real production proof;
- SKUD, GIS/OSS, ERP/1C, emergency provider and notification-provider depth must
  stay adapter/stub/evidence-baseline work until real systems exist.

## 2. Target Outcome

Before connecting a real database, DomHub must have:

1. A clean critical backend test gate.
2. A canonical test tenant seed that is deterministic and idempotent.
3. A seeded-test-DB E2E path for the main resident, guard, admin and staff
   workflows.
4. OpenAPI and frontend v1 contract drift gates passing.
5. Frontend lint and typecheck passing.
6. Tenant migration/preflight checks that can run from an empty test database.
7. Restore-drill coverage against test dumps, with real retained backup evidence
   explicitly marked as future work.
8. Documentation that separates implemented code from real-pilot evidence.

## 3. Status Vocabulary

Use these statuses in planning and status docs:

| Status | Meaning |
|---|---|
| `implemented` | Code exists for the main path. |
| `unit-tested` | Business logic has focused tests. |
| `contract-tested` | API shape/status/enums are checked. |
| `seeded-db-tested` | Scenario runs against the canonical test tenant. |
| `e2e-tested` | Browser/backend E2E path passed against seeded test data. |
| `requires-real-db` | Needs real/staging/prod DB evidence. |
| `requires-field-validation` | Needs live property/operator/security validation. |
| `requires-external-provider` | Needs a real SKUD/GIS/ERP/SMS/etc. provider. |

Do not use `production-validated` until the system has run against the target
real database and retained operational evidence exists.

## 4. Execution Phases

### Phase 0 — Freeze Expansion And Snapshot

Purpose: stop widening scope while the test contour is not fully reliable.

Tasks:

- Keep billing, OCR, booking, broad smart-home, AI modules and deep white-label
  expansion out of the current execution path.
- Keep legacy runtime removal as post-cutover work (`DH-62`).
- Audit uncommitted access/pass changes and split them into clear change sets.
- Update `domhub-project-implementation-status.md` only with evidence that was
  actually run.

Acceptance:

- `git status --short --branch` is understood before new implementation work.
- Every active task maps to platform-v1/access/operations/test-DB readiness.
- No new work is planned against deprecated `/api/*` aliases.

### Phase 1 — Recover The Critical Test Gate

Purpose: restore confidence before adding or polishing flows.

Status: completed as of 2026-05-20 local verification.

Latest verification:

- `cd backend && npm run test:coverage:critical`: 32 suites, 629 tests passed.
- `cd backend && npm run test:contract`: 1 suite, 8 tests passed.
- `npm run openapi:drift`: ok, 51 mounted prefixes covered.
- `npm run frontend:v1-contract-coverage`: ok, 274 calls checked.

Tasks:

- Keep this gate green while changing access, announcements, documents, requests
  or notification flows.
- If it regresses, fix the route/service contract instead of weakening the gate.
- Record the command output in implementation status when using it as release
  evidence.

Commands:

```bash
cd backend
npm run test:coverage:critical
npm run test:contract
```

Acceptance:

- Critical backend coverage gate passes.
- Contract tests pass.
- The fix is explained as route/contract behavior, not hidden under broad test
  rewrites.

### Phase 2 — Canonical Test Tenant

Purpose: make the test database a product-like stand-in, not a manual dev DB.

Status: improved as of 2026-05-20 local verification.

Latest verification:

- `backend/src/e2e/seedV1Access.js` now seeds a management company binding,
  property admin, technician, contractor company/user, canonical access topology,
  resident and contractor vehicles, contractor access request/pass, visit log,
  access incident, override, notification outbox row and property audit row.
- Re-running `node backend/src/e2e/seedV1Access.js` preserves canonical ids and
  reports stable canonical invariant counts.
- `npm run tenant:preflight:local`: global/platform/tenant DB reachable,
  migrations current.
- `npm run tenant:preflight:e2e`: global/platform/tenant DB reachable.
- `npm run test:e2e:v1-access`: 3 Playwright tests passed against the seeded
  test DB.

The canonical tenant seed must create:

- platform admin;
- management company;
- property;
- at least one `residential_complex` contour;
- at least one `cottage_community` contour or mode-specific E2E option;
- buildings, entrances, units or cottage homes;
- residents with ownership/unit links;
- property admin, concierge, security, technician and contractor users;
- contractor company and contractor user;
- vehicles;
- access zones and access points/checkpoints;
- access policies;
- guest pass;
- vehicle access request;
- visit logs;
- one access incident and override/audit trace;
- notification/outbox sample rows where external channels stay stubbed.

Tasks:

- Review `backend/src/e2e/seedV1Access.js` and the tenant preflight scripts.
- Make seed execution deterministic and idempotent.
- Add or preserve invariant checks for expected core rows.
- Keep seed data property-scoped and safe for repeated local runs.

Commands:

```bash
npm run tenant:preflight:local
npm run tenant:preflight:e2e
npm run test:e2e:v1-access
```

Acceptance:

- A fresh test DB can be migrated, seeded and exercised without manual data.
- Re-running the seed does not duplicate or corrupt core entities.
- E2E data has stable users, roles, property slugs and checkpoint ids.

### Phase 3 — Access-Core Proof

Purpose: prove the core DomHub value before operations and integrations expand.

Status: improved as of 2026-05-20 local verification.

Latest verification:

- `e2e/v1-access-production.spec.js` now proves the resident access path,
  vehicle registration/request path, admin-created checkpoint/policy baseline,
  guard checkpoint selection, QR verify, plate verify and manual security
  decision on the seeded test tenant.
- The same E2E gate now asserts visit-log details, linked manual
  incident/override evidence, idempotent offline replay duplicate handling,
  degraded checkpoint reconciliation and sensitive audit rows for manual
  override/reconciliation.
- `npm run test:e2e:v1-access`: tenant preflight passed with migrations `76/76`
  and 3 Playwright tests passed.

Required scenario:

1. Resident creates a guest pass.
2. Resident registers a vehicle.
3. Resident creates a vehicle access request.
4. Property admin manages zones, points and policy baseline.
5. Guard selects a checkpoint.
6. Guard verifies QR.
7. Guard verifies vehicle plate.
8. Manual admit/deny writes visit log, incident/override and audit.
9. Offline/degraded replay remains idempotent.
10. Policy decision is stored and visible in API responses/audit.

Tasks:

- Verify `access_point_id` and `direction` across request, pass, verify,
  visit-log and audit flows.
- Preserve stale mutation protection such as `expectedCurrentStatus` conflicts.
- Add only high-value E2E coverage for user-critical paths.

Acceptance:

- The resident -> guard -> audit path passes on the seeded test tenant.
- Cross-property access is denied or invisible.
- Sensitive/manual actions are auditable.

### Phase 4 — Operations Baseline

Purpose: prove that a pilot property can be operated after access is working.

Required scenario:

1. Resident creates a service request.
2. Staff or concierge triages/assigns it.
3. Technician or contractor acts on it.
4. Internal comments stay staff-only.
5. Resident-visible updates are visible to the resident.
6. Notification/outbox evidence is recorded, even if channel delivery is stubbed.

Tasks:

- Keep `/api/v1/requests` as the current compatibility bridge, but do not add
  new product contracts to deprecated legacy aliases.
- Verify SLA/assignment events and role-scoped visibility.
- Confirm staff, technician and contractor pages match backend permissions.

Acceptance:

- One complete operations request lifecycle passes on seeded test data.
- Permission tests cover resident/staff/technician/contractor separation.
- Stubs are labeled as stubs and not described as provider delivery evidence.

### Phase 5 — Frontend Pilot Ergonomics

Purpose: polish only the screens needed for a credible test-DB pilot rehearsal.

Priority screens:

- resident access;
- guard console;
- property admin access;
- staff workspace;
- technician workspace;
- contractor workspace;
- operations dashboard;
- sensitive-action/admin evidence pages where needed.

Tasks:

- Confirm `frontend/src/v1/V1Router.tsx` role redirects land in v1 flows.
- Avoid relying on the legacy UI for supported pilot scenarios.
- Check loading, empty, conflict and API-error states.
- Keep guard console efficient: checkpoint, entry/exit, QR/plate result, manual
  decision and degraded replay must be obvious.

Commands:

```bash
npm run typecheck
npm run frontend:lint
npm run frontend:test -- src/v1/V1Router.test.tsx
```

Acceptance:

- Main role entry points route to v1 screens.
- A seeded tenant can be demoed without manual API calls for critical flows.
- Legacy fallback is documented where it still exists.

### Phase 6 — Test-DB E2E Matrix

Purpose: create a small, reliable regression matrix.

Minimum E2E scenarios:

- tenant bootstrap and login;
- resident guest pass;
- resident vehicle registration;
- admin access topology/policy baseline;
- guard QR verify;
- guard plate verify;
- manual admit/deny;
- service request lifecycle;
- notification/outbox visibility;
- package intake/pickup;
- emergency dispatch drill in stub/test mode;
- privacy/offboarding smoke.

Acceptance:

- E2E runs against seeded test data.
- E2E does not depend on stale manual rows.
- Flaky tests are fixed or removed from release-blocking gates with an explicit
  reason and replacement coverage.

### Phase 7 — Legacy Containment

Purpose: keep legacy as compatibility only.

Tasks:

- Maintain a list of legacy routes/surfaces still used by supported flows.
- For each legacy dependency, classify it as replace, keep as shim, or remove
  after cutover.
- Run frontend contract coverage and OpenAPI drift checks after changes.

Commands:

```bash
npm run frontend:v1-contract-coverage
npm run openapi:drift
```

Acceptance:

- All new product behavior uses `/api/v1/*` or `/platform/api/v1/*`.
- `DH-62` remains blocked until v1 replacement flows and gates are proven.

### Phase 8 — Real DB Preparation Pack

Purpose: make future real-DB onboarding procedural.

Prepare:

- environment variable checklist;
- migration checklist;
- tenant provisioning checklist;
- seed/import checklist;
- backup/restore checklist;
- post-connect smoke checklist;
- rollback plan;
- feature-flag list;
- stub integration list;
- manual validation list for property operators/security.

Commands to keep ready:

```bash
npm run tenant:preflight:current
npm run tenant:restore-drill:preflight
npm run tenant:restore-drill
npm run release:gate:check
```

Acceptance:

- A future real DB can be connected through a documented sequence.
- Unknowns are limited to real credentials, real data import and provider/field
  validation.

## 5. Current Command Gate

The local/test-DB readiness gate is:

```bash
npm run openapi:drift
npm run frontend:v1-contract-coverage
npm run typecheck
npm run frontend:lint
cd backend && npm run test:contract
cd backend && npm run test:coverage:critical
npm run tenant:preflight:local
npm run test:e2e:v1-access
```

`npm run test` remains desirable as a broad regression check, but if it is too
slow for the current loop, split it into the release-relevant gates above and
record which ones actually ran.

## 6. Explicit Non-Goals Until Real DB Exists

- Billing.
- OCR.
- Booking.
- AI modules.
- Broad smart-home expansion.
- Deep white-label/customer-branding expansion.
- Certified GIS ЖКХ behavior.
- Legally authoritative OSS voting.
- Real SKUD command execution beyond selected provider lab work.
- Production notification-provider claims.
- Full legacy runtime removal.

## 7. Near-Term Ordered Backlog

1. Keep backend critical coverage and contract gates green after every access,
   content or operations change.
2. Re-run OpenAPI drift and frontend v1 contract coverage after API/frontend
   contract changes.
3. Audit current uncommitted documentation/status changes and stage them only
   when the plan/status wording matches the latest evidence.
4. Harden canonical test tenant seed and idempotency checks.
5. Keep canonical test tenant seed idempotent as the access and operations
   scenarios evolve.
6. Prove resident -> guard -> audit access scenario beyond the current access
   smoke by asserting canonical audit/outbox evidence where useful.
7. Prove service request -> staff/technician/contractor -> notification scenario.
8. Update implementation status with only commands that actually passed.
9. Prepare the real-DB onboarding checklist before seeking production-like
    evidence.
