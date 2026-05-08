# Module Spec — `service_requests` / `/api/v1/requests` bridge

**Status:** Draft

**Backlog:** `DH-22 Request Categories And Request Core`, `DH-23 Request Attachments And Resident Updates`, `DH-24 Assignment, SLA, And Escalation Engine`

**Runtime baseline:** existing `requests` table extended by `v1_029_service_request_core`, resident-visible communication tables from `v1_030_request_attachments_updates`, and assignment/SLA state from `v1_031_request_assignment_sla`

## 1. Purpose

DomHub service requests cover non-access operational work: unit/home issues, common territory, КПП/barrier problems, roads, lighting, waste, water, landscaping, security and emergency dispatch. The first implementation keeps `/api/v1/requests` as the compatibility API and extends it with v1 service-request fields instead of introducing a second disconnected controller.

## 2. Data Model

`service_request_categories`

- `property_id`, `code`, `name`
- `domain`: `access`, `service`, `territory`, `emergency`, `security`, `contractor`
- `target_scope`: `unit`, `home`, `access_zone`, `access_point`, `common_territory`, `road`, `service_area`
- `priority`: `low`, `normal`, `high`, `emergency`
- `sla_profile`: `standard`, `urgent`, `emergency`
- `first_response_minutes`, `resolution_minutes`
- `is_emergency`, `is_active`, `metadata`

Extended `requests`

- `request_category_id`
- `target_type`, `target_id`
- `priority`, `sla_profile`
- `first_response_due_at`, `resolution_due_at`
- `emergency_metadata`
- `assigned_to_uid`, `assigned_to_name`, `assigned_to_role`, `assigned_at`
- `first_response_at`, `resolved_at`, `completed_at`
- `sla_state`, `escalation_level`, `escalated_at`, `escalation_reason`, `last_sla_check_at`

`request_attachments`

- `request_id`, `uploaded_by_uid`
- `file_url`: canonical local `/uploads/<filename>` URL only
- `file_kind`: `photo`, `document`, `other`
- `visibility`: `resident` or `internal`
- `metadata`, `created_at`

`request_updates`

- `request_id`
- `actor_uid`, `actor_name`, `actor_role`
- `body`
- `visibility`: `resident` or `internal`
- `attachment_ids`, `created_at`

`request_sla_events`

- `request_id`, `event_key`
- `event_type`: `first_response_overdue`, `resolution_overdue`, `emergency_escalated`, `manual_escalation`
- `severity`: `warning`, `breach`, `emergency`
- `due_at`, `detected_at`
- `metadata`, `created_at`

## 3. API

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/requests/categories` | authenticated | Return configured active categories or built-in defaults. |
| `PUT` | `/api/v1/requests/categories/:code` | `admin` | Create/update a property-specific category. |
| `POST` | `/api/v1/requests` | resident/staff | Create legacy-compatible access/service/territory/emergency request. |
| `GET` | `/api/v1/requests` | creator/staff | List requests with existing visibility rules. |
| `GET` | `/api/v1/requests/:id` | creator/staff | Retrieve request with v1 service fields. |
| `GET` | `/api/v1/requests/:id/attachments` | creator/staff | List request attachments visible to the caller. |
| `POST` | `/api/v1/requests/:id/attachments` | creator/staff | Attach an owned local upload to the request as resident-visible communication. |
| `GET` | `/api/v1/requests/:id/updates` | creator/staff | List resident-visible updates for residents; staff may retrieve all visibility rows. |
| `POST` | `/api/v1/requests/:id/updates` | creator/staff | Create a resident-visible request update/comment. |
| `POST` | `/api/v1/requests/:id/assign` | manager staff/admin | Assign request to staff/technician/contractor and move pending work to accepted. |
| `POST` | `/api/v1/requests/:id/first-response` | manager staff/admin | Mark first-response timestamp without overwriting an existing value. |

## 4. Built-In Category Baseline

Territory categories include КПП/въезд, шлагбаум/ворота, roads, lighting, waste, water, landscaping, security, contractors and common area.

Emergency categories include water leak, heating, electricity, fire/smoke, access/barrier, security and emergency contractor.

Emergency categories must produce `priority='emergency'`, `sla_profile='emergency'`, first-response due time and resolution due time at creation.

## 5. Acceptance Criteria

- Cottage-community requests can target common territory, road, access zone or access point without apartment-only fields.
- Categories are property-configurable through `/api/v1/requests/categories/:code`.
- Emergency requests are visibly distinct in stored priority/SLA fields.
- Existing legacy request flows remain compatible with `pass`/`car` categories.
- Attachments only accept canonical local upload references and validate upload ownership for residents.
- Resident-visible updates are a separate table from internal history; internal visibility is stored at schema level but not exposed for creation in DH-23.
- Requests can be assigned to operational roles with assignee metadata.
- First-response/resolution timestamps and SLA state are stored on the request.
- Overdue first-response and resolution breaches persist idempotent `request_sla_events` before downstream notifications.
- Emergency requests escalate with `severity='emergency'` and `sla_state='emergency_escalated'`.
- Tests cover category listing/configuration, territory request creation, emergency request creation, attachment visibility/invalid URL flows, resident update visibility, assignment/SLA escalation and migration SQL shape.

## 6. Deferred

- Dedicated `service_requests` table split.
- Internal-only staff notes UI/API.
- Company-level SLA reporting UI.
- Full technician/contractor execution queue (`DH-25` to `DH-30`).
