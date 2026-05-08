# Module Spec — `contractor_workspace` / `/api/v1/contractor-workspace`

**Status:** Draft

**Backlog:** `DH-29 Contractor Workflow Backend`

**Dependencies:** `DH-04`, `DH-16`, `DH-27`

## 1. Purpose

Contractor workspace is the restricted execution API for external contractor users. Staff and concierge teams still triage requests and choose the contractor; the contractor API only exposes assigned work, limited request detail, start/resume, waiting-for-parts and resolution output.

The module continues to use the existing `requests` table as the service-request runtime bridge. Dedicated contractor portal UI is deferred to `DH-30`.

## 2. Data Model

Extended `requests`

- `assigned_contractor_user_id`: UUID link to `contractor_users`.
- `assigned_contractor_company_id`: UUID link to `contractor_companies`.

The existing request fields from `DH-27` are reused for execution output:

- `started_at`
- `resolution_note`
- `requires_follow_up`

`request_contractor_events`

- `request_id`
- `contractor_user_id`
- `contractor_company_id`
- `contractor_uid`
- `actor_uid`, `actor_name`, `actor_role`
- `event_type`: `assigned`, `started`, `resumed`, `waiting_parts`, `resolved`
- `from_status`, `to_status`
- `metadata`, `created_at`

## 3. API

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/contractor-workspace/queue` | contractor/concierge/admin | Contractor-scoped queue with filters. |
| `GET` | `/api/v1/contractor-workspace/requests/:id` | assigned contractor/concierge/admin | Limited request detail. Contractors do not receive internal staff notes or SLA event internals. |
| `POST` | `/api/v1/contractor-workspace/requests/:id/assign` | concierge/admin | Assign a request to an active, non-expired contractor user from an active company. |
| `POST` | `/api/v1/contractor-workspace/requests/:id/start` | assigned contractor/admin | Move assigned/waiting work to `in_progress`; sets first response timestamp. |
| `POST` | `/api/v1/contractor-workspace/requests/:id/resume` | assigned contractor/admin | Alias for resuming `waiting_parts` work to `in_progress`. |
| `POST` | `/api/v1/contractor-workspace/requests/:id/waiting` | assigned contractor/admin | Move `in_progress` to `waiting_parts` with optional internal note. |
| `POST` | `/api/v1/contractor-workspace/requests/:id/resolve` | assigned contractor/admin | Move `in_progress` to `resolved`; persists resolution note, follow-up flag and result attachment ids. |

## 4. Queue Filters

Supported filters:

- `queue`: `active`, `mine`, `in_progress`, `waiting`, `waiting_assignment`, `resolved`, `all`
- `status`: comma-separated request statuses
- `contractor_user_id`
- `contractor_company_id`
- `category`
- `priority`: `low`, `normal`, `high`, `emergency`
- `target_type`, `target_id`
- `unit_id`, `home_id`, `access_zone_id`, `access_point_id`
- `q`
- `limit`, `offset`

Default queue is `mine` for contractors and `active` for concierge/admin.

## 5. State Rules

- `assign`: request status in `pending`, `scheduled`, `new`, `triaged`, `accepted`, `assigned`, `waiting_contractor`, `waiting_parts`; contractor user must be active, not expired, have `external_uid`, and belong to an active company.
- `start`: assigned contractor request in `accepted`/`assigned` or `waiting_parts` resume state to `in_progress`.
- `waiting`: only `in_progress` to `waiting_parts`.
- `resolve`: only `in_progress` to `resolved`; `resolutionNote` is required.

`assigned_to_*` remains the legacy compatibility surface. `assigned_contractor_*` is the v1 identity binding used for scope checks and analytics.

## 6. Acceptance Criteria

- Contractor can load only requests assigned to their active, non-expired contractor profile.
- Expired/inactive contractor profiles and suspended/terminated companies cannot use the contractor workspace.
- Concierge/admin can assign contractor work only to active contractor users from active companies.
- Contractor detail payload hides internal staff notes and SLA internals.
- Contractor can start/resume, wait for parts and resolve through enforced transitions.
- Contractor KPI events are stored for assignment/start/resume/wait/resolve actions.
- Tests cover visibility, access expiry, assignment validation, limited payloads, lifecycle transitions and migration SQL shape.

## 7. Deferred

- Contractor portal UI (`DH-30`).
- Contractor access policy issuance tied to physical zones/service windows.
- Company-level SLA dashboards and completion-quality analytics.
- Dedicated result photo upload flow.
