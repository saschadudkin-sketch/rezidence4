# Frontend v1 Contract Coverage Audit

Date: 2026-05-17
Scope: `/api/v1/*` backend operations vs frontend usage in `frontend/src`.

## Method

- Backend source: `scripts/openapi-v1-drift-gate.cjs`, which extracts mounted `/api/v1/*` operations from `backend/src/app/registerApiRoutes.js` and `backend/src/app/registerObservabilityRoutes.js`.
- Frontend source: `scripts/frontend-v1-contract-coverage.cjs`, which extracts calls from `v1Client`, `apiClient`, and direct `fetch` calls in non-test frontend source.
- Product gaps exclude explicitly documented non-UI surfaces: low-level runtime plumbing, external provider callbacks/jobs, and legacy utility modules frozen behind `legacy_utilities_enabled`.

## Summary

| Metric | Count |
|---|---:|
| Backend mounted `/api/v1` operations | 339 |
| Frontend-used operations | 304 |
| Uncovered operations | 37 |
| Product gap operations after exclusions | 0 |
| Intentionally excluded / non-product-UI operations | 37 |

Verdict: frontend no longer has known product contract gaps against the canonical `/api/v1` backend surface. The remaining uncovered operations are intentionally excluded because they are runtime plumbing, provider/backend-only integration entry points, or legacy utility surfaces deferred by product freeze.

## Gate Results

```bash
npm run frontend:v1-contract-coverage
```

Result:

```text
[frontend-v1-contract-coverage] ok (274 calls, 271 v1Client, 3 direct URLs)
```

```bash
npm run openapi:drift
```

Result:

```text
[openapi-v1-drift] ok (51 mounted prefixes covered)
```

## No Current Product Gaps

The audit returned an empty `productGapBuckets` list. Previously open slices have frontend client coverage, including:

- access incidents: create, status, assign, resolve, dismiss, reopen, overrides, and video evidence linkage/fetch.
- analytics: packages, requests, SLA, traffic, snapshots, latest snapshot, and top residents.
- integrations: SKUD hardware/provider operations, ERP provider/sync/import/export operations, webhooks CRUD/test/delivery coverage, and video provider/evidence surfaces.
- request lifecycle: detail, history, attachments, updates, emergency queue/dispatch/evidence, ratings, and category administration.
- privacy compliance: readiness, evidence, data subject export/request flows, account deletion, and DSAR completion.
- property administration: staff, contractors, memberships, residents, buildings, entrances, units, imports, deactivation, transfer, and consent operations.

## Intentionally Uncovered Surfaces

These backend operations are not counted as frontend product gaps:

- legacy utilities frozen behind `legacy_utilities_enabled`: billing, meter readings, spaces, bookings, and chat stream/message compatibility surfaces.
- external/provider integration entry points: billing sync, visit clip ingestion, and SKUD provider event callbacks.
- low-level runtime plumbing: auth refresh, client logs, event health, upload signing/photo upload, telegram/push link-token plumbing, and public announcement feed.
- legacy runtime/admin surfaces superseded by bounded platform-v1 flows: selected users and visit-log compatibility operations.

## Repeatable Commands

```bash
npm run frontend:v1-contract-coverage
npm run openapi:drift
node scripts/frontend-v1-contract-coverage.cjs --json
```
