# Frontend v1 Contract Coverage Audit

Date: 2026-05-16
Scope: `/api/v1/*` backend operations vs frontend usage in `frontend/src`.

## Method

- Backend source: `scripts/openapi-v1-drift-gate.cjs`, which extracts mounted `/api/v1/*` operations from `backend/src/app/registerApiRoutes.js` and `backend/src/app/registerObservabilityRoutes.js`.
- Frontend source: `scripts/frontend-v1-contract-coverage.cjs`, which extracts calls from `v1Client`, `apiClient`, and direct `fetch` calls in non-test frontend source.
- Excluded from product gap count: auth/session helpers, SSE/event health, upload/client-log plumbing, public endpoints, push/telegram plumbing, and legacy utility surfaces such as billing, bookings, spaces, meter readings, blacklist, chat, perms, templates, users, and visit-logs.

## Summary

| Metric | Count |
|---|---:|
| Backend mounted `/api/v1` operations | 339 |
| Frontend-used operations | 166 |
| Uncovered operations | 174 |
| Product gap operations after exclusions | 138 |
| Intentionally excluded / non-product-UI operations | 36 |

Verdict: frontend still materially lags backend. The core resident/security/staff happy paths exist, and the previous notifications/outbox slice closed one backend-only area, but property-admin configuration, integrations, privacy, analytics, and deeper incident/request workflows remain incomplete.

## Priority Findings

### P1: Property Admin Configuration Is Still Thin

Backend has mature object administration surfaces, but frontend only exposes fragments:

- `/api/v1/staff`: list/detail/create/update/deactivate/import are backend-only in v1 UI.
- `/api/v1/contractor-companies`, `/api/v1/contractor-users`, `/api/v1/contractors/import/*`: no admin management UI.
- `/api/v1/memberships`: resident/unit membership lifecycle is not surfaced.
- `/api/v1/units`, `/api/v1/buildings`, `/api/v1/entrances`: onboarding import exists, but structure CRUD is mostly missing.
- `/api/v1/residents`: list/detail/offboarding exists partially; create/update/deactivate/transfer/consent flows are not complete.

Impact: admins cannot operate a property end-to-end from platform-v1 UI even though backend contracts exist.

Recommended next slice: build a `PropertyDirectoryAdminPage` covering structure, residents, memberships, staff, and contractors in phased tabs.

### P1: Integration Operations Have Backend But Almost No UI

Backend-only or nearly backend-only surfaces:

- `/api/v1/erp/*`: provider configs, sync jobs, export, import preview/apply.
- `/api/v1/webhooks/*`: webhook CRUD, deliveries, test.
- `/api/v1/skud/hardware-devices/*`: hardware map, boundaries, manual control events/actions.
- `/api/v1/video/*` and `/api/v1/video-evidence/*`: provider/camera config and incident evidence fetch/linking.

Impact: production-readiness work for SKUD, video, webhooks, and ERP cannot be managed without direct API calls.

Recommended next slice after admin directory: `IntegrationOperationsPage` with SKUD hardware, ERP providers, webhooks, and video evidence readiness.

### P1: Request Lifecycle UI Does Not Cover Full Backend Contract

Frontend covers basic request list/create/update through legacy provider and staff workspace actions, but gaps remain:

- `GET /api/v1/requests/:id`, `/attachments`, `/history`, `/updates`.
- `POST /api/v1/requests/:id/attachments`, `/updates`, `/emergency-dispatch`, `/rate`.
- `GET /api/v1/requests/emergency/queue`.
- `POST /api/v1/requests/emergency/provider-delivery-evidence`.
- `GET /api/v1/requests/categories` and `PUT /api/v1/requests/categories/:code`.

Impact: staff/resident request detail is not aligned with backend evidence, attachments, emergency dispatch, and category administration.

Recommended slice: extend `StaffWorkspacePage` and resident request detail to consume full request detail/history/attachments, then add emergency queue controls.

### P1: Privacy / Russia Readiness Is Mostly Backend-Only

Only consent modal is wired. Missing UI coverage:

- `/api/v1/privacy/readiness`.
- `/api/v1/privacy/compliance-evidence`.
- `/api/v1/privacy/data-subject-export`.
- `/api/v1/privacy/data-subject-requests`.
- account deletion / DSAR completion flows.

Impact: legal-readiness endpoints exist but are not operationally usable from UI.

Recommended slice: `PrivacyCompliancePage` for admins and resident-facing DSAR/export entry points.

### P2: Access Incident Operations Are Read-Heavy In UI

Frontend lists incidents in access admin, but backend has richer operations:

- create incident, assign, status, resolve, dismiss, reopen.
- access override detail.
- video evidence list/link/fetch around incidents.

Impact: incident handling remains partially read-only and cannot close the loop for guards/admins.

Recommended slice: deepen `AccessAdminPage` incident tab before adding full video-provider management.

### P2: Notification Slice Is Better, But Not Complete

The new notifications page covers:

- `/api/v1/admin/outbox`
- `/api/v1/admin/outbox/metrics`
- `/api/v1/admin/outbox/:id`
- `/api/v1/admin/outbox/:id/requeue`
- `/api/v1/admin/outbox/:id/cancel`
- `/api/v1/admin/notification-log`
- `/api/v1/admin/notification-log/metrics`
- `/api/v1/admin/notification-log/:id`

Remaining gaps:

- `/api/v1/admin/outbox/sla`.
- `/api/v1/notifications/outbox/health`.
- `/api/v1/notifications/outbox/retry`.
- `/api/v1/notification-log/_meta`.
- `GET /api/v1/notification-log/mine` has a client but no resident notification center page.

Impact: operations can inspect queue/logs, but health/SLA and resident notification center are still missing.

Recommended slice: add health/SLA panel to `NotificationOperationsPage`, then add `/v1/my/notifications`.

## Suggested Execution Order

1. Notifications completion: outbox SLA/health/retry plus resident notification center.
2. Property admin directory: structure, residents, memberships, staff, contractors.
3. Request lifecycle depth: detail/history/attachments/emergency queue/evidence.
4. Access incident workflow: mutation actions plus video evidence linkage.
5. Integration operations: SKUD hardware, ERP, webhooks, video providers.
6. Privacy compliance UI.
7. Analytics UI beyond operations dashboard, if still needed after dashboard/portfolio rollups.

## Repeatable Command

```bash
node scripts/frontend-v1-contract-coverage.cjs
```

For machine-readable output:

```bash
node scripts/frontend-v1-contract-coverage.cjs --json
```
