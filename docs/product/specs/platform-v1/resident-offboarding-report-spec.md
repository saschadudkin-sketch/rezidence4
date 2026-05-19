# Resident Offboarding Report

Status: Draft / implemented baseline
Scope: `DH-55` resident lifecycle/offboarding report evidence

## 1. Purpose

Resident deactivation already cascades through memberships, unit links, active passes, pending resident-created access requests, resident-owned trusted visitor templates and vehicle access review markers. `DH-55` adds an admin evidence surface so property admins can verify recent offboarding effects without querying the database directly.

This report is operational evidence over lifecycle/audit rows. It is not an ownership-transfer workflow and does not replace legal sale/lease-end documentation.

## 2. API

Endpoint:

- `GET /api/v1/residents/offboarding-report?property_id=<uuid>&limit=25`

Auth:

- requires an authenticated property admin for the requested `property_id`;
- residents and non-admin staff are blocked by the existing residents route guard.

Response shape:

```json
{
  "report": {
    "property_id": "uuid",
    "generated_at": "2026-05-11T07:00:00.000Z",
    "summary": {
      "offboarded_residents": 12,
      "offboarded_last_30d": 3,
      "vehicles_pending_review": 2,
      "recent_offboarding_rows": 10
    },
    "recent_offboardings": [],
    "vehicle_review_queue": [],
    "evidence": {
      "source_tables": [
        "resident_lifecycle_events",
        "resident_unit_links",
        "passes",
        "access_requests",
        "vehicles",
        "trusted_visitors",
        "property_audit_log"
      ],
      "report_scope": "resident_offboarding",
      "generated_at": "2026-05-11T07:00:00.000Z"
    }
  }
}
```

## 3. Evidence Model

The report reads:

- `resident_lifecycle_events` for deactivation history and offboarding summaries;
- `residents` for current resident name/unit/active state;
- `vehicles` for records still marked `review_required=true` after offboarding;
- `trusted_visitors` for resident-owned frequent guest templates deactivated by offboarding;
- source-table evidence metadata for reviewer traceability.

The service does not expose raw PII beyond the resident name already visible to property admins in the residents module.

## 4. Frontend

`/v1/admin/offboarding` shows:

- summary KPIs for total offboarded, last-30-day offboarding, vehicle-review queue and returned lifecycle rows;
- recent offboarding rows with cascade counts from the lifecycle event metadata;
- vehicle review queue with whitelist/blacklist/review state;
- evidence source tables and generated timestamp.

The page requires a selected property context. Without one, it renders a property-binding warning and does not call the report API.

## 5. Acceptance

- Property admins can deep-link to `/v1/admin/offboarding`.
- The route calls `/api/v1/residents/offboarding-report` with the selected property id.
- Backend service aggregates deactivation rows and vehicle review queue without ad hoc SQL in the route.
- Focused backend and frontend tests cover service aggregation, route auth, page rendering and router access.
- Ownership-transfer workflow and notification preference cascade are covered by `resident-ownership-transfer-spec.md`; this report remains the deactivation/offboarding evidence surface.
