# Module Spec - `role_scope_memberships` (platform-v1)

**Phase:** 2/3 bridge (`DH-03` role and scope foundation) + `DH-09` permission middleware adoption
**Status:** Draft
**Migration:** `backend/src/v1/migrations/026_role_scope_memberships.js`
**Source:** `domhub-access-jira-ready-backlog.md` / `DH-03 Memberships And Roles`

---

## 1. Purpose

`role_scope_memberships` records which v1 subject has which operational role at which property-local scope.

Current v1 already separates profiles into `residents`, `staff_users`, and `contractor_users`, and `authz.js` already exposes role/capability checks. The missing `DH-03` bridge is a formal membership layer that can be used by future access zones, request assignment, sensitive-data review, and resident lifecycle/offboarding work.

This module intentionally does not replace legacy JWT login or every existing route gate in one step. It provides the persistence and scope-aware authorization primitives that later tickets can adopt incrementally.

---

## 2. Functional Requirements

- **FR-1:** The system MUST store a membership for exactly one local subject: resident, staff user, or contractor user.
- **FR-2:** A membership MUST have one of the final DomHub roles: `resident`, `security`, `concierge`, `technician`, `contractor`, `property_admin`, `management_company_admin`, `platform_admin`.
- **FR-3:** A membership MUST be scoped to one level from the shared scope catalog.
- **FR-4:** `property` scope MUST use `property_id` and MUST NOT require `scope_id`.
- **FR-5:** Non-property scope levels MUST use `scope_id`.
- **FR-6:** Active duplicate memberships for the same subject, role, scope level and scope id MUST be rejected.
- **FR-7:** Authorization helpers MUST support role checks plus scope checks without breaking existing role-only `can()` behavior.
- **FR-8:** Property-scoped create operations SHOULD compare the caller's resolved property context against the target `property_id`.
- **FR-9:** Id-only mutations on property-owned v1 resources MUST resolve the target row's `property_id` before writing.
- **FR-10:** A caller with a property-scoped admin role MUST NOT mutate a row from another property even when the route path only contains `:id`.
- **FR-11:** Parent-owned create operations SHOULD validate that parent rows (`building_id`, `unit_id`, `contractor_company_id`) belong to the requested `property_id`.

---

## 3. Non-Functional Requirements

- **NFR-1:** Membership lookups SHOULD be indexed by property, subject and scope.
- **NFR-2:** The migration MUST be idempotent and forward-only.
- **NFR-3:** Existing v1 routes MUST continue to work while they migrate to scope-aware checks.

---

## 4. Data Model

### `role_scope_memberships`

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `property_id` | UUID | required |
| `resident_id` | UUID | nullable FK to `residents` |
| `staff_user_id` | UUID | nullable FK to `staff_users` |
| `contractor_user_id` | UUID | nullable FK to `contractor_users` |
| `role` | varchar(40) | final DomHub role enum |
| `scope_level` | varchar(30) | shared scope enum |
| `scope_id` | UUID | null for property scope, required otherwise |
| `status` | varchar(20) | `active`, `suspended`, `revoked`, `expired` |
| `starts_at` | timestamptz | default `NOW()` |
| `ends_at` | timestamptz | nullable; must be after `starts_at` |
| `created_by_staff_id` | UUID | nullable FK to `staff_users` |
| `created_at` | timestamptz | default `NOW()` |
| `updated_at` | timestamptz | default `NOW()` |

---

## 5. Acceptance Criteria

- **AC-1:** Given the migration runs twice, when migrations replay, then the table and indexes are not duplicated or dropped.
- **AC-2:** Given a membership row has more than one subject id, when inserted, then the DB rejects it.
- **AC-3:** Given a `property` membership has `scope_id`, when inserted, then the DB rejects it.
- **AC-4:** Given a non-property membership has no `scope_id`, when inserted, then the DB rejects it.
- **AC-5:** Given a property admin checks a capability for the same property, when `canInScope` runs, then it allows the operation.
- **AC-6:** Given a property admin checks the same capability for another property, when `canInScope` runs, then it denies the operation.
- **AC-7:** Given a platform admin checks a property-scoped capability, when `canInScope` runs, then it allows the operation.
- **AC-8:** Given a property admin from property A creates a property-scoped resource for property B, when the route uses `canInPropertyScope`, then the route denies the operation before writing.
- **AC-9:** Given a property admin from property A patches a staff/resident/contractor/unit row from property B by UUID, when the route resolves row ownership, then it returns `403` before the update.
- **AC-10:** Given a property admin creates a child row under a parent from another property, when the route validates the parent scope, then it returns `400` or `403` before insert.

---

## 6. Out Of Scope

- Full v1 JWT subject migration.
- New login flows for staff or contractors.
- UI for editing memberships.
- Full conversion of every id-only mutation route outside the current platform-v1 access/people/structure foundation.
- Access-zone-specific permission assignment until `DH-06` creates durable zones and points.
