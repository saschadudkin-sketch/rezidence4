# Frontend v1 UI Workflow Coverage Audit

Date: 2026-05-17
Scope: production UI usage of `frontend/src/v1/api/*.ts` methods, excluding API modules and tests.

## Summary

| Metric | Count |
|---|---:|
| v1 API client methods | 272 |
| Methods without production UI usage | 63 |
| Analytics methods without production UI usage | 0 |
| Access incident methods without production UI usage | 0 |
| Privacy compliance methods without production UI usage | 0 |
| Integration operations methods without production UI usage | 0 |
| Property directory methods without production UI usage | 0 |

Verdict: frontend no longer has known `/api/v1` contract gaps, but product UI workflow depth is still incomplete for several bounded contexts. This audit tracks the next layer: client methods that exist for backend parity but are not yet reachable from production UI pages.

## Completed This Pass

- Wired `OperationsDashboardPage` to the detailed analytics clients:
  - `api.analytics.traffic`
  - `api.analytics.topResidents`
  - `api.analytics.sla`
  - `api.analytics.requests`
  - `api.analytics.packages`
  - `api.analytics.listSnapshots`
  - `api.analytics.latestSnapshot`
  - `api.analytics.createSnapshot`
- Added UI smoke coverage for the analytics detail panel and snapshot creation action.
- Wired `AccessAdminPage` incident workflow to the full access incident client:
  - detail load and edit
  - assign, status update, resolve, dismiss, reopen
  - standalone override creation and override detail check
  - video evidence list, manual link, and provider fetch
- Added UI smoke coverage for incident management payloads.
- Added `/v1/admin/privacy` with privacy readiness, consent, DSAR list/create/complete,
  data-subject export, compliance evidence list/create, and guarded account deletion.
- Added route and UI smoke coverage for privacy compliance payloads.
- Added `/v1/admin/integrations` with ERP provider/import/export/sync-job operations,
  SKUD hardware boundary/manual/evidence/pass-sync operations, webhook CRUD/test/delivery history,
  and video provider/camera/evidence operations.
- Added route and UI smoke coverage for integration operations payloads.
- Extended `/v1/admin/directory` from read-only lists to mutation coverage for:
  structure create/detail/update/deactivate/import, resident create/update/deactivate/transfer/consent,
  staff detail/create/update/deactivate/import, contractor company/user detail and mutations/import,
  and membership list-mine/create/revoke.
- Added UI smoke coverage for property directory mutation payloads.

## Remaining UI Workflow Gaps By API Module

| API module | Unused methods |
|---|---:|
| `serviceRequests.ts` | 10 |
| `auditReviews.ts` | 6 |
| `guardVisits.ts` | 6 |
| `passes.ts` | 5 |
| `securityWorkspace.ts` | 5 |
| `visits.ts` | 5 |
| `accessPolicies.ts` | 4 |
| `accessTopology.ts` | 3 |
| `announcements.ts` | 3 |
| `documents.ts` | 3 |
| `packages.ts` | 3 |
| `vehicles.ts` | 3 |
| `accessRequests.ts` | 1 |
| `adminOutbox.ts` | 1 |
| `contractorWorkspace.ts` | 1 |
| `gisOssReadiness.ts` | 1 |
| `notificationLog.ts` | 1 |
| `staffWorkspace.ts` | 1 |
| `trustedVisitors.ts` | 1 |

## Next Slices

1. Request lifecycle UI gaps: standalone request create/update/delete, attachment create, rating, and emergency queue visibility.
2. Access topology/policy edits: update/deactivate/evaluate flows beyond create/deactivate baseline.
3. Guard visit and visit-log parity: list/detail/create/verify surfaces for security operations.
4. Audit review operations: report evidence, sample/escalate/assign/review actions.

## Verification

```bash
npm run test -- src/v1/pages/AdminPages.smoke.test.tsx
npm run test -- src/v1/pages/AccessAdminPage.test.tsx
npm run test -- src/v1/pages/IntegrationOperationsPage.test.tsx src/v1/V1Router.test.tsx
npm run test -- src/v1/pages/PropertyDirectoryAdminPage.test.tsx
npm run test -- src/v1/pages/PrivacyCompliancePage.test.tsx src/v1/V1Router.test.tsx
npm run typecheck
npm run lint
npm run frontend:v1-contract-coverage
```
