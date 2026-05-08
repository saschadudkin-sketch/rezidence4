# Module Spec - Access Topology (platform-v1)

**Phase:** Core Access Foundation (`DH-06`)
**Status:** Draft
**Migration:** `backend/src/v1/migrations/027_access_topology.js`
**Source:** `domhub-access-jira-ready-backlog.md` / `DH-06 Access Zones And Points`

---

## 1. Purpose

Access topology makes physical checkpoints, gates, barriers, doors, intercoms and service entries first-class runtime objects.

Existing access requests, passes and visit logs already contain nullable zone/point identifiers, but there is no durable source of truth for those identifiers. This module creates `access_zones` and `access_points` so later policy, guard console, degraded checkpoint mode and hardware integrations can reference concrete topology instead of free-form planned checkpoint data.

---

## 2. Functional Requirements

- **FR-1:** The system MUST store `access_zones` per property.
- **FR-2:** The system MUST store `access_points` per property and zone.
- **FR-3:** A point MUST belong to a zone from the same property.
- **FR-4:** Supported zone types MUST include residential-complex and cottage-community use cases: perimeter, checkpoint, parking, street, sector, technical and service areas.
- **FR-5:** Supported point types MUST include checkpoint, gate, barrier, service gate, wicket, door, intercom and turnstile.
- **FR-6:** Property admins MUST be able to create, update and deactivate zones and points.
- **FR-7:** Staff/security roles MUST be able to list zones and points for guard/checkpoint selection.
- **FR-8:** Existing access request, pass and visit-log tables SHOULD become FK-ready for zone/point references without requiring immediate policy-engine adoption.
- **FR-9:** Access requests that include `target_zone_id` or `target_point_id` MUST validate that the referenced active topology rows belong to the same property before creation.
- **FR-10:** Passes issued from access requests MUST inherit the request's `target_zone_id` and `target_point_id` into `passes.zone_id` and `passes.point_id`.
- **FR-11:** Direct pass creation MAY include `zone_id` and `point_id`; when provided, both MUST reference active topology rows from the same property.
- **FR-12:** Guard verification and direct visit-log insertion MAY include `access_point_id`; when provided, it MUST reference an active access point from the same property and MUST be persisted to `visit_logs_v2.access_point_id`.
- **FR-13:** Onboarding import MAY include planned checkpoint/gate data; when provided, the system MUST provision matching `access_zones` and `access_points` idempotently.

---

## 3. Non-Functional Requirements

- **NFR-1:** List endpoints SHOULD be indexed by `property_id`, active status and sort order.
- **NFR-2:** The migration MUST be idempotent and forward-only.
- **NFR-3:** Existing rows with nullable or pre-topology identifiers MUST NOT block migration rollout.
- **NFR-4:** Route handlers SHOULD remain thin and keep topology validation in focused helpers.

---

## 4. API Contracts

| Method | Path | Capability | Notes |
|---|---|---|---|
| `GET` | `/api/v1/access-zones?property_id=&is_active=&zone_type=` | `access.topology.read` | List zones for one property. |
| `POST` | `/api/v1/access-zones` | `access.topology.write` | Create zone. |
| `PATCH` | `/api/v1/access-zones/:id` | `access.topology.write` | Update zone metadata/status fields. |
| `POST` | `/api/v1/access-zones/:id/deactivate` | `access.topology.write` | Soft deactivate zone. |
| `GET` | `/api/v1/access-points?property_id=&zone_id=&is_active=&point_type=` | `access.topology.read` | List points for one property or zone. |
| `POST` | `/api/v1/access-points` | `access.topology.write` | Create point after same-property zone check. |
| `PATCH` | `/api/v1/access-points/:id` | `access.topology.write` | Update point metadata/status fields. |
| `POST` | `/api/v1/access-points/:id/deactivate` | `access.topology.write` | Soft deactivate point. |
| `POST` | `/api/v1/access-requests` | `access.request.create` | Validates optional `target_zone_id` / `target_point_id` against active topology. |
| `POST` | `/api/v1/passes` | `passes:manage` | Validates optional `zone_id` / `point_id` against active topology. |
| `POST` | `/api/v1/visits/verify` | `access.qr.verify` / `access.plate.verify` | Validates optional `access_point_id` and stores it in the created visit log. |
| `POST` | `/api/v1/visits` | `access.qr.verify` / `access.plate.verify` | Validates optional `access_point_id` for direct visit-log insertion. |
| `POST` | `/api/v1/units/import` | `structure:write` | Converts `planned_access_points` into real checkpoint zones/points and returns `access_topology`. |

---

## 5. Data Models

### `access_zones`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `property_id` | UUID | required |
| `building_id` | UUID | nullable FK to `buildings` |
| `name` | varchar(100) | required |
| `zone_type` | varchar(30) | enum |
| `description` | text | nullable |
| `is_active` | boolean | default true |
| `sort_order` | integer | default 0 |
| `metadata` | jsonb | default `{}` |
| `created_at` | timestamptz | default `NOW()` |
| `updated_at` | timestamptz | default `NOW()` |

### `access_points`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `property_id` | UUID | required |
| `zone_id` | UUID | required FK to `access_zones(property_id, id)` |
| `name` | varchar(100) | required |
| `point_type` | varchar(30) | enum |
| `provider` | varchar(50) | nullable |
| `provider_external_id` | text | nullable |
| `description` | text | nullable |
| `is_active` | boolean | default true |
| `sort_order` | integer | default 0 |
| `metadata` | jsonb | default `{}` |
| `created_at` | timestamptz | default `NOW()` |
| `updated_at` | timestamptz | default `NOW()` |

---

## 6. Acceptance Criteria

- **AC-1:** Given a property admin creates a zone with a supported `zone_type`, when the request is valid, then the API returns `201` with the zone.
- **AC-2:** Given a property admin creates a point for a zone from another property, when the API checks the zone, then the API rejects the request.
- **AC-3:** Given staff/security lists points for a property, when `property_id` is resolved, then only that property's points are returned.
- **AC-4:** Given an access request/pass/visit log references a zone or point after this migration, when the referenced topology row does not exist, then the DB rejects the new reference.
- **AC-5:** Given existing rows have null or historical topology ids, when the migration runs, then rollout is not blocked by old data.
- **AC-6:** Given a resident creates an access request with `target_point_id`, when that point is active for the same property, then creation succeeds and any auto-issued pass inherits `point_id`.
- **AC-7:** Given staff creates a direct pass with `zone_id` or `point_id`, when the topology row is missing, inactive or belongs to another property, then the API returns `400`.
- **AC-8:** Given a guard verifies a QR or plate scan with `access_point_id`, when the point is active for the same property, then the created visit log stores that `access_point_id`.
- **AC-9:** Given a guard verifies or inserts a visit log with an access point from another property, when the request is validated, then the API returns `400` before writing a visit log.
- **AC-10:** Given onboarding import includes `checkpoint_name` and `checkpoint_type`, when import succeeds, then the response includes the planned point and the provisioned `access_topology.points` row.

---

## 7. Out Of Scope

- Access policy CRUD and policy evaluation (`DH-13`, `DH-14`).
- Full topology admin screen beyond guard-console point selection.
- Degraded/offline checkpoint mode (`DH-57` / pilot hardening).
- Hardware registry and vendor adapters (`DH-59`).
- Video/camera mapping.
