# Module Spec — `technician_workspace_ui` / `/v1/technician-workspace`

**Status:** Draft

**Backlog:** `DH-28 Technician Workflow UI`

**Dependencies:** `DH-27`

## 1. Purpose

Technician workspace UI is the field execution screen for technical specialists. It consumes `/api/v1/technician-workspace` and keeps the technician flow separate from staff triage: assigned queue, available work, start/resume, waiting status, resolution note and result attachment ids.

## 2. Route

`/v1/technician-workspace`

Role gate:

- allowed: `technician`, `admin`, `property_admin`, `management_company_admin`, `platform_admin`
- `/v1` redirects `technician` users to this route.

## 3. Screen Composition

- Header with property context.
- Filter toolbar:
  - queue: `mine`, `available`, `in_progress`, `waiting`, `resolved`, `active`, `all`
  - status
  - priority
  - search `q`
- Left queue list:
  - resident/name/category
  - status and priority
  - target/unit context
  - SLA due marker
- Right execution panel:
  - request summary and SLA metadata
  - lifecycle buttons derived from backend `workflow`
  - waiting form with `resident` or `parts`
  - resolution form with `resolutionNote`, `requiresFollowUp`, `attachmentIds`
  - attachments list
  - technician events
  - internal and resident communication timelines

## 4. State Rules

The UI does not infer state transitions locally except to decide which form sections to render from backend-provided `workflow` booleans:

- `canClaim`
- `canStart`
- `canResume`
- `canWait`
- `canResolve`

Backend remains authoritative for conflicts and returns `409` if the request changed.

## 5. Acceptance Criteria

- Technician can open `/v1/technician-workspace` from role redirect.
- Technician can load queue/detail and switch filters.
- Technician can claim available work.
- Technician can start or resume assigned work.
- Technician can move in-progress work to waiting resident/parts with note.
- Technician can resolve work with resolution note, follow-up flag and result attachment ids.
- Tests cover route redirect/gate and main execution path.

## 6. Deferred

- Direct photo upload inside the technician UI. DH-28 links existing request attachment ids; upload UX can be added once the media flow is consolidated.
- Offline task cache and mobile push workflow.
- Workload analytics dashboard.
