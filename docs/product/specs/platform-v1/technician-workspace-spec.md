# Module Spec — `technician_workspace` / `/api/v1/technician-workspace`

**Status:** Draft

**Backlog:** `DH-27 Technician Workflow Backend`

**Dependencies:** `DH-22`, `DH-23`, `DH-24`, `DH-25`

## 1. Purpose

Technician workspace is the execution API for technical specialists. Staff workspace handles triage, assignment and resident context; technician workspace handles the narrower field workflow: assigned queue, available work, start/resume, waiting transitions and resolution output.

The module continues to use the existing `requests` table as the service-request runtime bridge. A dedicated `service_requests` table split remains deferred.

## 2. Data Model

Extended `requests`

- `started_at`: first time the technician moved the task into work.
- `resolution_note`: final work output note.
- `requires_follow_up`: boolean marker for post-resolution staff follow-up.

`request_technician_events`

- `request_id`
- `technician_uid`
- `actor_uid`, `actor_name`, `actor_role`
- `event_type`: `claimed`, `started`, `resumed`, `waiting_resident`, `waiting_parts`, `resolved`
- `from_status`, `to_status`
- `metadata`, `created_at`

Result photos use existing `request_attachments` plus the resolution internal update `attachment_ids`. No separate photo table is introduced in DH-27.

## 3. API

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/technician-workspace/queue` | technician/admin | Technician-scoped queue with filters. |
| `GET` | `/api/v1/technician-workspace/requests/:id` | technician/admin | Request detail with attachments, updates, SLA events and technician events. |
| `POST` | `/api/v1/technician-workspace/requests/:id/claim` | technician | Claim unassigned technician-eligible work. |
| `POST` | `/api/v1/technician-workspace/requests/:id/start` | assigned technician/admin | Move assigned/waiting work to `in_progress`; sets `started_at` and first response timestamp. |
| `POST` | `/api/v1/technician-workspace/requests/:id/resume` | assigned technician/admin | Alias for resuming `waiting_*` work to `in_progress`. |
| `POST` | `/api/v1/technician-workspace/requests/:id/waiting` | assigned technician/admin | Move `in_progress` to `waiting_resident` or `waiting_parts` with optional internal note. |
| `POST` | `/api/v1/technician-workspace/requests/:id/resolve` | assigned technician/admin | Move `in_progress` to `resolved`; persists resolution note, follow-up flag and result attachment ids. |

## 4. Queue Filters

Supported filters:

- `queue`: `active`, `mine`, `available`, `in_progress`, `waiting`, `resolved`, `all`
- `status`: comma-separated request statuses
- `category`
- `priority`: `low`, `normal`, `high`, `emergency`
- `target_type`, `target_id`
- `unit_id`, `home_id`, `access_zone_id`, `access_point_id`
- `assignee_uid`
- `q`
- `limit`, `offset`

Default queue is `mine` for technicians and `active` for admins.

## 5. State Rules

- `claim`: unassigned request with no assignee role or `assigned_to_role='technician'`, status in `pending`, `scheduled`, `new`, `triaged`, `accepted`, `assigned`.
- `start`: `accepted`/`assigned` compatibility state or `waiting_resident`/`waiting_parts` resume state to `in_progress`.
- `waiting`: only `in_progress` to `waiting_resident` or `waiting_parts`.
- `resolve`: only `in_progress` to `resolved`; `resolutionNote` is required.

`accepted` is treated as the legacy compatibility alias for product-state `assigned` until the final service-request state machine is split from legacy request statuses.

## 6. Acceptance Criteria

- Technician can load only their assigned work plus unassigned technician-eligible work.
- Non-technician staff cannot access technician workspace routes.
- Technician can claim, start/resume, wait and resolve requests through enforced transitions.
- Resolution output persists on `requests` and can link result attachment ids through an internal update.
- Technician KPI events are stored for claim/start/resume/wait/resolve actions.
- Tests cover role visibility, state transitions, result submission and migration SQL shape.

## 7. Deferred

- Technician specialization matching beyond `assigned_to_role='technician'`.
- Workload balancing and schedule capacity.
- Dedicated result photo table.
- Technician UI (`DH-28`).
- Contractor execution model (`DH-29`, `DH-30`).
