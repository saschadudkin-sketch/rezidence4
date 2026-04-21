# DomHub First Working MVP Jira-Ready Backlog

This document converts the first working MVP checklist into a bounded Jira-ready backlog.

It is narrower than the full DomHub backlog. It is intended for the first real MVP delivery wave only.

## Scope

- Goal: deliver the first working DomHub MVP
- Delivery style: one ticket = one bounded implementation slice suitable for one PR
- Primary outcome:
  - resident guest pass flow
  - resident vehicle pass flow
  - security allow/deny/manual override
  - staff request queue baseline
  - property admin dashboard baseline
  - first pilot-ready vertical slice

## Source Of Truth

- `domhub-first-working-mvp-checklist.md`
- `domhub-access-platform-final-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-state-machines-spec.md`
- `domhub-access-api-contract-spec.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`
- `domhub-test-strategy-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`

## Ticket Rules

- Keep tickets bounded.
- Do not combine unrelated backend, frontend, and infrastructure work in one ticket unless explicitly stated.
- `/api/v1/*` remains the contract source of truth.
- No ticket is complete without tests and required documentation touchpoints.
- Do not expand beyond the first working MVP scope.

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

## MVP-01 Freeze MVP Scope

**Summary**
Freeze the exact first working MVP scope and explicitly defer non-MVP modules.

**Scope**
- Confirm the first working MVP role set
- Confirm the MVP object model
- Confirm the MVP access, request, and admin feature list
- Record explicit `after MVP` exclusions

**Implementation Notes**
- This is a product control ticket, not a coding ticket
- It blocks uncontrolled scope growth across design and implementation

**Definition of Done**
- MVP scope is documented and frozen
- Non-MVP modules are explicitly deferred
- Team has one agreed implementation cut line

**Dependencies**
- None

**Out of Scope**
- Backlog expansion
- Additional modules beyond the MVP definition

---

## MVP-02 Create Main Figma MVP File

**Summary**
Create the main DomHub Figma file for the first working MVP.

**Scope**
- Create one Figma product file
- Add the minimum first-wave pages
- Add cover/source-of-truth orientation
- Align file structure with existing Figma spec docs

**Implementation Notes**
- Use `domhub-figma-file-template.md`
- Keep the file lean and implementation-oriented

**Definition of Done**
- Main Figma file exists
- Minimum first-wave pages exist
- File uses the agreed page naming and structure

**Dependencies**
- `MVP-01`

**Out of Scope**
- Full component library
- Complete multi-role screen set

---

## MVP-03 Port Visual Foundations Into Figma

**Summary**
Bring the first DomHub token and visual foundation layer into Figma.

**Scope**
- Create color, typography, spacing, and density foundations
- Add semantic token groupings
- Add role-density guidance

**Implementation Notes**
- Use `domhub-design-tokens-css-spec.md`
- Keep the first pass close to the code-side semantic token model

**Definition of Done**
- Figma foundations exist and are reusable
- Visual system is coherent enough to support the first MVP screens

**Dependencies**
- `MVP-02`

**Out of Scope**
- Dark mode
- Advanced theme variants

---

## MVP-04 Build First MVP Components In Figma

**Summary**
Build the minimal reusable component set required for the first MVP screens.

**Scope**
- Build first-wave buttons, inputs, cards, panels, status pills, navigation, metric cards, queue rows, and security decision components
- Keep naming aligned with component structure docs

**Implementation Notes**
- Use `domhub-figma-component-library-structure.md`
- Do not overbuild the design system

**Definition of Done**
- Required first-wave Figma components exist
- Components are sufficient to assemble the first MVP screens

**Dependencies**
- `MVP-03`

**Out of Scope**
- Full enterprise-scale component library
- Expansion-role components outside MVP

---

## MVP-05 Finalize Resident MVP Screens In Figma

**Summary**
Design and freeze the resident-facing first working MVP screens.

**Scope**
- `Resident / Home`
- `Resident / Guest Pass / Form`
- `Resident / Guest Pass / Success`
- `Resident / Vehicle Pass / Form`
- `Resident / Vehicle Pass / Success`

**Implementation Notes**
- Use the premium mobile-first direction
- Keep the resident UI calm and simple

**Definition of Done**
- Resident MVP screens exist in Figma
- Screens are annotated and ready for implementation

**Dependencies**
- `MVP-04`

**Out of Scope**
- Full resident module expansion
- Documents and notifications center beyond what the MVP needs

---

## MVP-06 Finalize Security And Staff MVP Screens In Figma

**Summary**
Design and freeze the operational first working MVP screens.

**Scope**
- `Security / Workspace / Default`
- `Security / Workspace / QR Result / Allowed`
- `Security / Workspace / QR Result / Denied`
- `Staff / Request Queue`

**Implementation Notes**
- Security must be action-first
- Staff queue must be dense but readable

**Definition of Done**
- Security and staff MVP screens exist in Figma
- Screens are annotated and ready for implementation

**Dependencies**
- `MVP-04`

**Out of Scope**
- Concierge package module
- Technician and contractor dedicated screens

---

## MVP-07 Finalize Property Admin MVP Screen In Figma

**Summary**
Design and freeze the property admin dashboard required for the first working MVP.

**Scope**
- `Property Admin / Dashboard`
- KPI and visibility composition for requests, incidents, and access status

**Implementation Notes**
- Treat this as a one-property control room, not a portfolio dashboard

**Definition of Done**
- Property admin dashboard exists in Figma
- Dashboard is annotated and implementation-ready

**Dependencies**
- `MVP-04`

**Out of Scope**
- Management company portfolio dashboard
- Full admin settings suite

---

## MVP-08 Implement Tenant And Property Foundations

**Summary**
Implement the minimum tenant and property model required for the MVP.

**Scope**
- `management_company`
- `property`
- `building`
- `entrance`
- `unit`
- tenant resolution and ownership constraints

**Implementation Notes**
- Keep route handlers thin
- Put ownership and integrity checks in services/helpers

**Definition of Done**
- Schema and migrations exist
- Tenant/property foundations work under `/api/v1/*`
- Tests cover invalid scope and hierarchy cases

**Dependencies**
- `MVP-01`

**Out of Scope**
- Bulk import
- Per-tenant provisioning automation

---

## MVP-09 Implement Roles And Memberships

**Summary**
Implement the role and membership model for the MVP role set.

**Scope**
- `resident`
- `security`
- `concierge/staff`
- `property_admin`
- membership resolution and authorization primitives

**Implementation Notes**
- Keep role resolution reusable across access and request flows

**Definition of Done**
- Membership model exists
- Authorization primitives work across MVP routes
- Tests cover primary role boundaries

**Dependencies**
- `MVP-08`

**Out of Scope**
- Full management company admin model
- Platform admin UI

---

## MVP-10 Implement Resident, Staff, And Vehicle Entities

**Summary**
Implement the main MVP subject entities needed for access and requests.

**Scope**
- resident profile baseline
- staff profile baseline
- vehicle entity and ownership rules

**Implementation Notes**
- Vehicle must be treated as a first-class entity for the MVP

**Definition of Done**
- Resident, staff, and vehicle entities exist
- Associations and validation rules are enforced
- Tests cover invalid assignments and ownership issues

**Dependencies**
- `MVP-09`

**Out of Scope**
- Contractor domain expansion
- Advanced vehicle analytics

---

## MVP-11 Implement Access Request And Pass Lifecycle

**Summary**
Implement the core guest and vehicle access lifecycle for the MVP.

**Scope**
- access request
- pass issuance
- guest pass lifecycle
- vehicle pass lifecycle
- QR/token generation baseline

**Implementation Notes**
- Follow state-machine and API contract docs
- Keep lifecycle rules explicit and testable

**Definition of Done**
- Access request and pass lifecycle works end to end in backend/API
- Guest and vehicle flows are supported
- Tests cover valid and invalid transitions

**Dependencies**
- `MVP-10`

**Out of Scope**
- Recurring access
- Contractor access expansion
- Emergency access rules

---

## MVP-12 Implement Visit Logs, Access Events, And Incidents

**Summary**
Implement event visibility and incident baseline for the MVP access flows.

**Scope**
- visit log
- access event recording
- access incident baseline
- audit event recording for critical actions

**Implementation Notes**
- Critical actions must remain auditable
- Incidents only need the baseline workflow required by MVP security actions

**Definition of Done**
- Access events and visit logs are stored
- Incidents can be created from denied/override scenarios
- Audit trail exists for critical access actions

**Dependencies**
- `MVP-11`

**Out of Scope**
- Advanced forensic tooling
- Video evidence linking

---

## MVP-13 Implement Request Lifecycle Baseline

**Summary**
Implement the minimum resident-to-staff request workflow for the MVP.

**Scope**
- resident request creation
- request list/detail baseline
- assignment/status change baseline
- queue-compatible request model

**Implementation Notes**
- Keep request logic separate from route handlers
- Support the staff queue before adding deeper operations tooling

**Definition of Done**
- Requests can be created and moved through baseline states
- Staff queue data can be served by `/api/v1/*`
- Tests cover state changes and invalid transitions

**Dependencies**
- `MVP-09`

**Out of Scope**
- SLA automation depth
- Contractor execution workflows

---

## MVP-14 Expose MVP API Surface And Permissions

**Summary**
Expose the MVP backend through the required `/api/v1/*` routes and enforce permissions.

**Scope**
- routes for resident access requests
- passes
- vehicles
- security actions
- request queue
- property dashboard data
- role-aware authorization
- property/company scope checks

**Implementation Notes**
- `/api/v1/*` is the contract source of truth
- No MVP route should rely on deprecated aliases

**Definition of Done**
- Required MVP API endpoints exist
- Authorization and scope enforcement works consistently
- Tests cover key route permissions

**Dependencies**
- `MVP-11`
- `MVP-12`
- `MVP-13`

**Out of Scope**
- Expansion APIs beyond MVP
- Portfolio/admin modules outside MVP

---

## MVP-15 Build Shared Frontend MVP Shell Components

**Summary**
Implement the shared frontend primitives needed for the first MVP screens.

**Scope**
- top bar
- sidebar
- bottom nav
- metric card
- queue row
- pass row
- vehicle row
- detail side panel
- alert banner
- scan result panel
- allow/deny block

**Implementation Notes**
- Align with `frontend/src/styles/ds-tokens.css`
- Use the existing design-system and selector-based frontend patterns

**Definition of Done**
- Shared components exist in frontend code
- Components are reusable across the first MVP screens
- Lint and typecheck pass for the new layer

**Dependencies**
- `MVP-05`
- `MVP-06`
- `MVP-07`

**Out of Scope**
- Full component library extraction
- Non-MVP role components

---

## MVP-16 Implement Resident MVP Screens In Frontend

**Summary**
Build the resident-side first working MVP UI.

**Scope**
- Resident Home
- guest pass creation flow
- vehicle pass creation flow
- pass success states

**Implementation Notes**
- Resident experience must remain premium and mobile-first
- Use selectors for derived collections

**Definition of Done**
- Resident screens work against MVP APIs
- Guest and vehicle flows are usable end to end from frontend
- Frontend tests/smoke coverage exist where required

**Dependencies**
- `MVP-14`
- `MVP-15`

**Out of Scope**
- Resident expansion modules outside MVP

---

## MVP-17 Implement Security Workspace In Frontend

**Summary**
Build the security-side first working MVP UI.

**Scope**
- Security Workspace
- allowed result state
- denied result state
- manual override interaction baseline

**Implementation Notes**
- Optimize for clarity and fast action
- Preserve strong decision-state hierarchy

**Definition of Done**
- Security screens work against MVP APIs
- Allow/deny/manual override work end to end
- Event and incident outcomes are visible where required

**Dependencies**
- `MVP-14`
- `MVP-15`

**Out of Scope**
- Advanced guard tooling
- Video/SKUD overlays

---

## MVP-18 Implement Staff Queue And Property Admin Dashboard In Frontend

**Summary**
Build the final MVP operations screens in frontend.

**Scope**
- Staff Request Queue
- request detail side panel
- Property Admin Dashboard

**Implementation Notes**
- Keep staff dense and queue-first
- Keep property admin dashboard focused on MVP visibility only

**Definition of Done**
- Staff queue works against live data
- Request detail actions work at MVP level
- Property admin dashboard shows MVP request/access/incident visibility

**Dependencies**
- `MVP-14`
- `MVP-15`

**Out of Scope**
- Management company portfolio UI
- Advanced admin management panels

---

## MVP-19 Implement Notifications And CSV Import Baseline

**Summary**
Add the smallest notification and import baseline required for pilot-capable MVP usage.

**Scope**
- push/SMS/Telegram abstraction baseline
- pass notifications
- request notifications
- incident/admin notifications
- CSV import baseline for units, residents, and staff

**Implementation Notes**
- Keep provider logic abstracted for later expansion
- CSV import only needs MVP object onboarding coverage

**Definition of Done**
- Notifications can be triggered for MVP-critical flows
- Baseline CSV import works for MVP data onboarding
- Tests cover key import and notification paths where needed

**Dependencies**
- `MVP-14`

**Out of Scope**
- Full integration marketplace
- Deep 1C/ERP sync

---

## MVP-20 Establish Infrastructure, Test, And Pilot Readiness

**Summary**
Complete the MVP hardening pass required to move from “working in dev” to “ready for demo and pilot rehearsal.”

**Scope**
- verify auth/session behavior
- verify tenant isolation
- verify config/secrets strategy
- verify migrations
- verify staging environment
- add core unit/integration/E2E smoke coverage
- prepare seeded demo data
- rehearse happy path, deny path, override path, and request path
- prepare launch checklist and support notes

**Implementation Notes**
- This is the final MVP gate ticket
- Treat unresolved auth, scope, or staging issues as blockers

**Definition of Done**
- Staging is usable
- Core checks pass:
  - `npm run test`
  - `npm run e2e`
  - `npm run test:ci`
  - `npm run test:coverage:critical`
  - `npm run lint`
  - `npm run typecheck`
- Demo data exists
- Pilot rehearsal paths have been validated
- Launch/support notes exist

**Dependencies**
- `MVP-16`
- `MVP-17`
- `MVP-18`
- `MVP-19`

**Out of Scope**
- Production-scale hardening beyond MVP gate
- Broad vendor integration rollout

---

## Recommended Execution Order

1. `MVP-01`
2. `MVP-02` -> `MVP-03` -> `MVP-04`
3. `MVP-05`, `MVP-06`, `MVP-07`
4. `MVP-08` -> `MVP-09` -> `MVP-10`
5. `MVP-11` -> `MVP-12` -> `MVP-13`
6. `MVP-14`
7. `MVP-15`
8. `MVP-16`, `MVP-17`, `MVP-18`
9. `MVP-19`
10. `MVP-20`

## Release Gate Mapping

- `Gate A - Scope Freeze`
  - `MVP-01`

- `Gate B - Visual Freeze`
  - `MVP-02`
  - `MVP-03`
  - `MVP-04`
  - `MVP-05`
  - `MVP-06`
  - `MVP-07`

- `Gate C - Working Core Slice`
  - `MVP-08`
  - `MVP-09`
  - `MVP-10`
  - `MVP-11`
  - `MVP-12`
  - `MVP-13`
  - `MVP-14`
  - `MVP-15`
  - `MVP-16`
  - `MVP-17`
  - `MVP-18`

- `Gate D - Technical Readiness`
  - `MVP-19`
  - `MVP-20`

- `Gate E - Pilot Readiness`
  - `MVP-20`
