# DomHub Access Jira-Ready Backlog

This document converts the initial DomHub access-platform implementation plan into Jira-ready tickets.

## Scope

- Focus: first 20 implementation tickets for DomHub access/control core
- Goal: move from planning-ready documentation to a pilot-capable access platform foundation
- Ticket style: one ticket = one bounded delivery slice suitable for one PR

## Source Of Truth

- `domhub-access-platform-final-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-state-machines-spec.md`
- `domhub-access-api-contract-spec.md`
- `domhub-test-strategy-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`

## Ticket Rules

- Each ticket must stay within its defined scope.
- Do not combine schema changes, access policy changes, and unrelated UI work in one ticket unless explicitly stated.
- `/api/v1/*` remains the contract source of truth.
- No ticket is complete without tests and doc touchpoints where required.

## Ticket Template Guidance

Use these fields in Jira:

- `Title`
- `Summary`
- `Scope`
- `Implementation Notes`
- `Definition of Done`
- `Dependencies`
- `Out of Scope`

---

## DH-01 Tenant Foundation

**Summary**
Add platform-level tenant entities and request-time tenant resolution.

**Scope**
- Add `management_company` and `property` persistence model
- Add tenant resolution primitives for backend request lifecycle
- Add baseline platform/property ownership constraints
- Add migrations and core tests

**Implementation Notes**
- Keep route handlers thin
- Put tenant resolution and ownership logic into services/helpers
- Preserve `/api/v1/*` as the contract layer

**Definition of Done**
- Platform entities exist in schema and migrations
- Tenant resolution is available to downstream services
- Core tests cover isolation and invalid tenant access
- No cross-tenant data leakage in covered paths

**Dependencies**
- None

**Out of Scope**
- Full company admin UI
- Per-tenant deployment automation

---

## DH-02 Property Structure

**Summary**
Implement property hierarchy for buildings, entrances, and units.

**Scope**
- Add `building`, `entrance`, `unit`
- Add `/api/v1` CRUD endpoints for property structure
- Add validation and ownership checks
- Add tests for hierarchy consistency

**Implementation Notes**
- Derived collections should be selector-driven on frontend
- Backend validation should live in services/helpers

**Definition of Done**
- Schema and migrations are applied
- CRUD endpoints work under tenant scope
- Validation rejects invalid parent-child relationships
- Tests cover create/update/list/delete flows

**Dependencies**
- `DH-01`

**Out of Scope**
- Bulk CSV import
- Resident assignment flows

---

## DH-03 Memberships And Roles

**Summary**
Add role and membership model across platform, company, and property scopes.

**Scope**
- Add role enums and membership persistence
- Implement role-to-scope mapping
- Add backend authorization primitives
- Add tests for role resolution

**Implementation Notes**
- Roles in scope: `resident`, `security`, `concierge`, `technician`, `contractor`, `property_admin`, `management_company_admin`, `platform_admin`

**Definition of Done**
- Memberships can be resolved per request
- Role checks support platform/company/property scope
- Unauthorized access is rejected consistently
- Tests cover all primary roles

**Dependencies**
- `DH-01`
- `DH-02`

**Out of Scope**
- Full permission UI
- Role-specific dashboards

---

## DH-04 Profiles Domain

**Summary**
Implement resident, staff, and contractor profile entities.

**Scope**
- Add `resident`, `staff_user`, `contractor_company`, `contractor_user`
- Add links to unit/property/company scope
- Add `/api/v1` profile management endpoints
- Add validation and tests

**Implementation Notes**
- Contractor entities must remain separately scoped from internal staff

**Definition of Done**
- Profile entities exist and are linked correctly
- CRUD/API operations enforce scope and integrity
- Tests cover profile creation and retrieval rules

**Dependencies**
- `DH-01`
- `DH-02`
- `DH-03`

**Out of Scope**
- Full contractor access workflows
- Notification preferences

---

## DH-05 Vehicle Model

**Summary**
Add vehicle entities and vehicle ownership/access baseline.

**Scope**
- Add `vehicle` schema and associations
- Support resident/contractor ownership references
- Add whitelist/blacklist baseline fields
- Add `/api/v1` vehicle endpoints and tests

**Implementation Notes**
- Vehicle becomes a first-class access subject, not just a string field on a pass

**Definition of Done**
- Vehicle CRUD works under tenant scope
- Ownership and uniqueness rules are enforced
- Tests cover blacklist/whitelist flags and invalid assignments

**Dependencies**
- `DH-04`

**Out of Scope**
- ANPR integration
- Vehicle analytics dashboard

---

## DH-06 Access Zones And Points

**Summary**
Implement physical access topology for the property.

**Scope**
- Add `access_zone` and `access_point`
- Add point-to-zone and property mappings
- Add CRUD endpoints and validation
- Add tests for topology integrity

**Implementation Notes**
- Keep point types extensible for future SKUD/video integrations

**Definition of Done**
- Zones and points can be managed per property
- Invalid zone/point assignments are blocked
- Tests cover creation and hierarchy constraints

**Dependencies**
- `DH-02`

**Out of Scope**
- Camera mapping
- Vendor adapters

---

## DH-07 Access Request And Pass Schema

**Summary**
Add request and issued-pass model for access workflows.

**Scope**
- Add `access_request`, `pass`, `visit_log`
- Implement lifecycle enums from the state machine spec
- Add base repositories/services
- Add schema tests

**Implementation Notes**
- Separate requested access from issued pass state
- Keep state machine compatibility explicit

**Definition of Done**
- Schema supports request and pass lifecycle
- Constraints reflect valid ownership and status fields
- Tests cover persistence and integrity

**Dependencies**
- `DH-04`
- `DH-05`
- `DH-06`

**Out of Scope**
- QR generation
- Approval logic

---

## DH-08 Access Incident And Audit Schema

**Summary**
Implement incident and audit entities for access control operations.

**Scope**
- Add `access_incident` and `audit_event`
- Define incident categories and audit baselines
- Add persistence and retrieval services
- Add schema and service tests

**Implementation Notes**
- Audit events should support future forensic views
- Treat audit records as append-only operationally

**Definition of Done**
- Incident and audit entities are persisted correctly
- Core access actions can be represented in audit records
- Tests cover creation and linkage to passes/requests/vehicles

**Dependencies**
- `DH-07`

**Out of Scope**
- Incident UI
- Video evidence linking

---

## DH-09 Permission Middleware

**Summary**
Apply role and scope authorization across `/api/v1` access routes.

**Scope**
- Add middleware/helpers for role and scope enforcement
- Enforce property/company/platform access rules
- Add tests for authorization failures and allowed paths

**Implementation Notes**
- Reuse a consistent authorization surface instead of per-route ad hoc checks

**Definition of Done**
- Protected routes use shared authorization checks
- Tests cover happy-path and forbidden-path scenarios
- No access route bypasses documented checks

**Dependencies**
- `DH-03`
- `DH-04`
- `DH-07`
- `DH-08`

**Out of Scope**
- Frontend hiding logic
- Fine-grained analytics permissions

---

## DH-10 Access Request Service

**Summary**
Implement backend lifecycle for access requests.

**Scope**
- Create service for request creation/update/cancel/approve transitions
- Enforce state machine rules
- Add `/api/v1` request endpoints
- Add tests for valid and invalid transitions

**Implementation Notes**
- Keep transition logic out of routes
- Use explicit status transition validation

**Definition of Done**
- Request service implements documented transitions
- Invalid transitions return stable API errors
- Tests cover lifecycle and stale-state edge cases

**Dependencies**
- `DH-07`
- `DH-09`

**Out of Scope**
- QR issuance
- Security console actions

---

## DH-11 Pass Issuance And QR Flow

**Summary**
Implement issued pass generation and public QR access flow.

**Scope**
- Generate pass tokens/QR payloads
- Add public pass lookup endpoint
- Implement revoke/expire behavior
- Add tests for token validity and expiry

**Implementation Notes**
- Public pass view must remain narrowly scoped
- Avoid leaking unrelated resident or property data

**Definition of Done**
- Passes can be issued from approved requests
- Public pass lookup returns only intended data
- Revoke/expire flow works and is tested

**Dependencies**
- `DH-10`

**Out of Scope**
- Scanner UI
- Video evidence

---

## DH-12 Vehicle Access Service

**Summary**
Implement vehicle-based access request and pass handling.

**Scope**
- Link vehicles to access requests and passes
- Support guest and contractor vehicle access cases
- Add visit logging for vehicle entries/exits
- Add tests for vehicle-specific scenarios

**Implementation Notes**
- Keep vehicle access behavior aligned with generic pass lifecycle where possible

**Definition of Done**
- Vehicle-based access can be requested and issued
- Vehicle entries are auditable and queryable
- Tests cover blacklist and ownership edge cases

**Dependencies**
- `DH-05`
- `DH-10`
- `DH-11`

**Out of Scope**
- Plate recognition
- Barrier integrations

---

## DH-13 Policy And Approval CRUD

**Summary**
Add storage and management APIs for access policies and approval rules.

**Scope**
- Add `access_policy` CRUD
- Add approval rule representation
- Validate policy conflicts and invalid references
- Add tests for policy persistence and validation

**Implementation Notes**
- Keep policy authoring separate from policy evaluation

**Definition of Done**
- Policies can be created, listed, updated, and archived
- Invalid policy references are rejected
- Tests cover zone/point/time-window validation

**Dependencies**
- `DH-06`
- `DH-07`
- `DH-09`

**Out of Scope**
- Policy execution engine
- Policy analytics

---

## DH-14 Policy Evaluation Engine

**Summary**
Implement rule evaluation for access permissions and decisions.

**Scope**
- Evaluate who can access which point/zone and when
- Return allow/deny/override-needed decisions
- Support approval and blacklist checks
- Add service-level tests and API integration tests

**Implementation Notes**
- Make evaluation deterministic and testable
- Prefer explicit evaluation traces for debugging

**Definition of Done**
- Evaluation service returns consistent results for documented scenarios
- Tests cover precedence, conflicts, and time-window logic
- API consumers can call evaluation safely

**Dependencies**
- `DH-11`
- `DH-12`
- `DH-13`

**Out of Scope**
- Vendor SKUD synchronization
- UI policy builder polish

---

## DH-15 Security Workspace API

**Summary**
Provide backend APIs for the guard/security console.

**Scope**
- Active passes feed
- Expected guests feed
- Search by pass, resident, unit, vehicle
- Recent access events
- Blacklist hit visibility

**Implementation Notes**
- Optimize for guard workflow, not generic reporting
- Keep bulk hydrate and incremental updates separate

**Definition of Done**
- Security API supports primary console workflows
- Search returns scoped, relevant results
- Tests cover query behavior and security scope

**Dependencies**
- `DH-08`
- `DH-11`
- `DH-12`
- `DH-14`

**Out of Scope**
- Scanner UI
- Video links

---

## DH-16 Manual Override And Incident Flow

**Summary**
Implement guard-side allow/deny/manual override actions and incident generation.

**Scope**
- Manual allow/deny endpoints
- Override reasons and audit events
- Automatic incident creation for selected failure/override scenarios
- Tests for override and incident behavior

**Implementation Notes**
- Every manual action must leave an audit trail
- Incident policy should be explicit, not hidden in UI code

**Definition of Done**
- Guards can allow/deny/override through backend actions
- Audit events capture actor, reason, and target
- Incident linkage is created for configured scenarios

**Dependencies**
- `DH-08`
- `DH-14`
- `DH-15`

**Out of Scope**
- Incident investigation UI
- Video evidence retrieval

---

## DH-17 Resident Access UI

**Summary**
Implement resident-facing flows for guest and vehicle access requests.

**Scope**
- Create guest access requests
- Create vehicle access requests
- View request/pass status and history
- Handle request validation and error states

**Implementation Notes**
- Keep resident UI narrow and self-service focused
- Use selectors for derived collections

**Definition of Done**
- Resident can create and review access requests end-to-end
- UI reflects backend statuses correctly
- Tests cover key flows and permission boundaries

**Dependencies**
- `DH-10`
- `DH-11`
- `DH-12`

**Out of Scope**
- Security console
- Company dashboards

---

## DH-18 Security Workspace UI

**Summary**
Implement guard-facing console for access operations.

**Scope**
- Active pass list
- Search and result handling
- Allow/deny/manual override actions
- Recent events view
- Incident launch entry points

**Implementation Notes**
- Optimize for speed, clarity, and low-click workflow
- Separate initial load from real-time updates where applicable

**Definition of Done**
- Guard can complete core desk workflows through UI
- Actions are wired to backend endpoints and statuses
- Tests cover primary operational scenarios

**Dependencies**
- `DH-15`
- `DH-16`

**Out of Scope**
- Video playback
- Vendor device control

---

## DH-19 Property Admin UI

**Summary**
Implement property admin screens for access configuration and monitoring.

**Scope**
- Manage zones and points
- Manage access policies
- Manage blacklist/whitelist entries
- View access incidents for the property

**Implementation Notes**
- Keep configuration flows distinct from resident and security workflows

**Definition of Done**
- Property admin can manage access configuration through UI
- Policy and point/zone changes persist correctly
- Tests cover config changes and scoped admin access

**Dependencies**
- `DH-06`
- `DH-13`
- `DH-16`

**Out of Scope**
- Management company portfolio view
- Vendor integration settings

---

## DH-20 Onboarding, Import, And Smoke E2E

**Summary**
Deliver pilot-ready onboarding and a smoke-tested access slice.

**Scope**
- Import residents, units, staff, and vehicles
- Add seed/demo data flow
- Add onboarding helpers for first property setup
- Add smoke E2E scenarios for the core access journey

**Implementation Notes**
- Focus on pilot readiness, not full enterprise import complexity

**Definition of Done**
- New property can be initialized with minimal seed/import process
- Smoke E2E covers resident request to guard action flow
- Pilot demo environment is repeatable

**Dependencies**
- `DH-17`
- `DH-18`
- `DH-19`

**Out of Scope**
- Full ERP/1C sync
- SKUD vendor adapters

---

## Execution Order

Recommended order:

1. `DH-01` to `DH-04`
2. `DH-05` to `DH-09`
3. `DH-10` to `DH-16`
4. `DH-17` to `DH-20`

## Release Gate Mapping

- `Core Access Foundation`
  - `DH-01` to `DH-09`
- `Operational Access Backend`
  - `DH-10` to `DH-16`
- `Pilot-Capable Access Product`
  - `DH-17` to `DH-20`

## Notes For Ticket Authors

- If a ticket changes data model, link both schema and API contracts.
- If a ticket changes status flow, update state-machine docs.
- If a ticket touches permissions, include forbidden-path tests.
- If a ticket spans more than one bounded workflow, split it before implementation.
