# Module Spec — `staff_workspace` / `/api/v1/staff-workspace`

**Status:** Draft

**Backlog:** `DH-25 Staff Workspace API`

**Dependencies:** `DH-22`, `DH-23`, `DH-24`

## 1. Purpose

Staff workspace is the operational API layer for concierge, security and property admin request handling. It turns service requests into queues that staff can actually work: active inbox, overdue queue, request detail, resident quick view and internal comments.

This module is intentionally API-only. The final staff UI is `DH-26`.

## 2. API

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/staff-workspace/inbox` | staff/admin | Unified operational inbox with filters. |
| `GET` | `/api/v1/staff-workspace/overdue` | staff/admin | Shortcut for overdue/SLA-breached queue. |
| `GET` | `/api/v1/staff-workspace/requests/:id` | staff/admin | Aggregated request detail with attachments, resident updates, internal comments and SLA events. |
| `POST` | `/api/v1/staff-workspace/requests/:id/internal-comments` | staff/admin | Store internal-only staff comment. |
| `GET` | `/api/v1/staff-workspace/residents/:id/quick-view` | staff/admin | Resident/unit/vehicle/request context for staff handling. |

## 3. Inbox Filters

Supported filters:

- `queue`: `active`, `unassigned`, `assigned`, `mine`, `overdue`, `emergency`, `all`
- `status`: comma-separated request statuses
- `category`
- `priority`: `low`, `normal`, `high`, `emergency`
- `sla_profile`: `standard`, `urgent`, `emergency`
- `target_type`, `target_id`
- `unit_id`, `home_id`, `access_zone_id`, `access_point_id`
- `assignee_uid`
- `q`
- `limit`, `offset`

Default queue is `active`: deleted and terminal requests are excluded.

## 4. Visibility Rules

- Resident users cannot access staff workspace endpoints.
- Staff/admin can read request queues.
- Internal comments are stored in `request_updates` with `visibility='internal'`.
- Resident-visible updates remain separate with `visibility='resident'`.
- Resident quick view hides phone unless caller has `residents:read_phone`.

## 5. Acceptance Criteria

- Staff can load and filter operational queues via API.
- Overdue and emergency queues are deterministic and based on DH-24 SLA fields.
- Request detail aggregates the request work context in one API response.
- Internal comments are separate from resident-visible updates.
- Resident quick view exposes unit/vehicle/request context without leaking phone to roles that cannot view it.
- Tests cover queue filtering, access denial, internal comments and phone visibility.

## 6. Deferred

- Final staff UI (`DH-26`).
- Technician specialization queues (`DH-27`, `DH-28`).
- Contractor portal and restricted contractor queues (`DH-29`, `DH-30`).
- Company-level SLA reporting UI.
