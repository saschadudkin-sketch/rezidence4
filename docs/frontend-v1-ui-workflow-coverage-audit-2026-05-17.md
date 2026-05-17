# Frontend v1 UI Workflow Coverage Audit

Date: 2026-05-17
Scope: production UI usage of `frontend/src/v1/api/*.ts` methods, excluding API modules and tests.

## Summary

| Metric | Count |
|---|---:|
| v1 API client methods | 272 |
| Methods without production UI usage | 127 |
| Analytics methods without production UI usage | 0 |
| Access incident methods without production UI usage | 0 |

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

## Remaining UI Workflow Gaps By API Module

| API module | Unused methods |
|---|---:|
| `privacyCompliance.ts` | 10 |
| `serviceRequests.ts` | 10 |
| `contractors.ts` | 9 |
| `staff.ts` | 7 |
| `erpExchange.ts` | 6 |
| `skudIntegrations.ts` | 6 |
| `units.ts` | 6 |
| `videoEvidence.ts` | 6 |
| `webhooks.ts` | 6 |
| `auditReviews.ts` | 6 |
| `guardVisits.ts` | 6 |
| `passes.ts` | 5 |
| `residents.ts` | 5 |
| `securityWorkspace.ts` | 5 |
| `visits.ts` | 5 |
| `accessPolicies.ts` | 4 |
| `accessTopology.ts` | 3 |
| `announcements.ts` | 3 |
| `documents.ts` | 3 |
| `memberships.ts` | 3 |
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

1. Privacy compliance UI: readiness, DSAR/export, evidence, deletion, and completion actions.
2. Integration operations UI: ERP, SKUD hardware/manual control, webhooks, and video provider/evidence workflows.
3. Property directory mutations: staff, contractors, memberships, residents, units, and imports.
4. Access topology/policy edits: update/deactivate/evaluate flows beyond create/deactivate baseline.

## Verification

```bash
npm run test -- src/v1/pages/AdminPages.smoke.test.tsx
npm run test -- src/v1/pages/AccessAdminPage.test.tsx
npm run typecheck
npm run lint
npm run frontend:v1-contract-coverage
```
