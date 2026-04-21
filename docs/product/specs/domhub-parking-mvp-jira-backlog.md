# DomHub Parking MVP Jira-Ready Backlog

This document converts the DomHub parking module into a bounded first-wave Jira-ready backlog.

The purpose is not to build a full smart parking platform.

The purpose is to ship a useful parking MVP that extends the current garage/vehicle baseline into a controlled parking-access module for residential properties.

## Scope

- Goal: deliver the first working parking MVP inside DomHub
- Delivery style: one ticket = one bounded implementation slice suitable for one PR
- Primary outcome:
  - vehicle registry
  - guest vehicle pass
  - parking spot assignment baseline
  - security vehicle validation
  - parking event log
  - parking incident baseline

## Source Of Truth

- `domhub-parking-module-spec.md`
- `domhub-access-platform-final-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-access-api-contract-spec.md`
- `domhub-first-working-mvp-checklist.md`

## Ticket Rules

- Keep parking MVP bounded.
- Do not expand into smart parking automation before the baseline works.
- Do not mix billing, booking, ANPR, and heavy integrations into the MVP wave.
- `/api/v1/*` remains the contract source of truth.

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

## PKMVP-01 Freeze Parking MVP Scope

**Summary**
Freeze the first working parking MVP and explicitly defer non-MVP parking capabilities.

**Scope**
- Confirm resident vehicle and guest vehicle access scope
- Confirm security-side parking validation scope
- Confirm property admin parking visibility scope
- Record explicit out-of-scope items

**Implementation Notes**
- Keep parking MVP tightly aligned with DomHub access MVP

**Definition of Done**
- Parking MVP scope is documented and frozen
- Non-MVP parking items are explicitly deferred

**Dependencies**
- None

**Out of Scope**
- Smart parking automation
- Paid parking/billing

---

## PKMVP-02 Implement Parking Spot Domain

**Summary**
Add the minimum parking spot model required for a real parking module.

**Scope**
- `parking_spot`
- property linkage
- parking spot type
- parking spot status
- basic CRUD and validation

**Implementation Notes**
- Keep the model small and property-scoped
- Do not add visual map complexity

**Definition of Done**
- Parking spots exist in schema and API
- Property-scoped CRUD works
- Validation covers invalid assignments and statuses

**Dependencies**
- `PKMVP-01`

**Out of Scope**
- Multi-level visual maps
- Sensor occupancy

---

## PKMVP-03 Implement Parking Assignment Domain

**Summary**
Implement assignment of parking spots to units or residents.

**Scope**
- `parking_assignment`
- spot-to-unit or spot-to-resident linkage
- assignment lifecycle baseline
- reassignment/unassignment baseline

**Implementation Notes**
- Keep assignment history simple but auditable

**Definition of Done**
- Spots can be assigned and unassigned
- Object integrity rules are enforced
- Tests cover invalid and duplicate assignment cases

**Dependencies**
- `PKMVP-02`

**Out of Scope**
- Complex shared-parking logic
- Paid place reservation

---

## PKMVP-04 Normalize Current Vehicle Registry Into Parking MVP

**Summary**
Bring the existing garage/vehicle baseline into the new parking MVP domain model.

**Scope**
- align current vehicle data with parking MVP rules
- preserve resident vehicle CRUD
- ensure property-scoped ownership logic

**Implementation Notes**
- Reuse current garage baseline where possible
- Avoid breaking resident vehicle management UX

**Definition of Done**
- Existing vehicle registry is compatible with parking MVP rules
- Resident vehicle CRUD remains working
- Property and ownership validation is enforced

**Dependencies**
- `PKMVP-01`

**Out of Scope**
- Advanced vehicle analytics
- Contractor fleet logic

---

## PKMVP-05 Implement Guest Vehicle Pass Flow In Backend

**Summary**
Implement backend support for guest vehicle access as part of parking MVP.

**Scope**
- guest vehicle access request
- vehicle pass issuance
- validity window
- link to resident/property

**Implementation Notes**
- Reuse generic access lifecycle where possible

**Definition of Done**
- Guest vehicle pass can be created and validated in backend
- Tests cover happy path and invalid access cases

**Dependencies**
- `PKMVP-04`

**Out of Scope**
- Recurring parking passes
- Multi-property guest parking logic

---

## PKMVP-06 Implement Parking Event And Incident Baseline

**Summary**
Add parking-specific events and incidents.

**Scope**
- `parking_event`
- `parking_incident`
- allow/deny/manual override event recording
- deny reason capture

**Implementation Notes**
- Keep event taxonomy aligned with access-domain conventions

**Definition of Done**
- Parking events are stored
- Parking incidents can be created from deny/override cases
- Audit trail exists for critical parking actions

**Dependencies**
- `PKMVP-05`

**Out of Scope**
- Video evidence linkage
- Forensic analytics

---

## PKMVP-07 Expose Parking MVP API Surface

**Summary**
Expose the parking MVP through `/api/v1/*` routes.

**Scope**
- parking spots
- parking assignments
- vehicles
- guest vehicle passes
- parking events/incidents
- security vehicle lookup actions

**Implementation Notes**
- Keep the contract narrow and property-scoped

**Definition of Done**
- Required parking MVP endpoints exist
- Property-scoped authorization works
- Route-level tests cover critical permissions

**Dependencies**
- `PKMVP-03`
- `PKMVP-04`
- `PKMVP-05`
- `PKMVP-06`

**Out of Scope**
- ANPR adapter APIs
- Parking billing APIs

---

## PKMVP-08 Implement Resident Parking UI

**Summary**
Implement the resident-facing parking MVP UI.

**Scope**
- vehicle registry screen refinement
- add/edit/delete vehicle
- guest vehicle pass creation
- active vehicle access visibility

**Implementation Notes**
- Build on the existing `GarageView` baseline
- Keep the UX calm and lightweight

**Definition of Done**
- Resident can manage vehicles
- Resident can create guest vehicle passes
- Resident sees current vehicle-related access state

**Dependencies**
- `PKMVP-07`

**Out of Scope**
- Rich parking analytics for residents
- Occupancy views

---

## PKMVP-09 Implement Security Parking Validation UI

**Summary**
Implement the security-side parking validation interface.

**Scope**
- search by plate
- owner/unit visibility
- active access visibility
- allow/deny/manual override
- incident creation entry point

**Implementation Notes**
- This can extend the existing guard/security workflow rather than introducing a separate product shell

**Definition of Done**
- Security can validate vehicle access by plate
- Security can allow, deny, and override
- Parking event/incident flow is visible in UI

**Dependencies**
- `PKMVP-07`

**Out of Scope**
- Barrier integration UI
- ANPR live console

---

## PKMVP-10 Implement Property Admin Parking UI

**Summary**
Implement the property-admin-side parking controls for MVP.

**Scope**
- parking spot list
- parking assignments
- property vehicle registry
- block/unblock vehicle
- parking event log
- parking incident list

**Implementation Notes**
- Keep the UI operational and list-based
- Avoid overbuilding a “garage management suite”

**Definition of Done**
- Property admin can manage parking spots and assignments
- Property admin can inspect vehicle and parking event data
- Basic vehicle blocking controls exist

**Dependencies**
- `PKMVP-07`

**Out of Scope**
- Portfolio parking dashboard
- Advanced heatmaps

---

## PKMVP-11 Add CSV Parking Onboarding Baseline

**Summary**
Add basic import support required to onboard parking data for a property.

**Scope**
- CSV import for parking spots
- optional CSV import support for resident-to-spot assignments
- validation and import error handling baseline

**Implementation Notes**
- Keep CSV format simple and pilot-friendly

**Definition of Done**
- Parking spots can be imported for a property
- Import validation catches malformed rows
- Pilot onboarding does not depend on manual spot creation only

**Dependencies**
- `PKMVP-02`
- `PKMVP-03`

**Out of Scope**
- ERP sync
- Bulk external integrations

---

## PKMVP-12 Establish Parking MVP Test And Pilot Readiness

**Summary**
Complete the first parking MVP hardening pass required for demo and pilot use.

**Scope**
- unit/integration tests for parking domain
- happy path vehicle pass rehearsal
- deny path rehearsal
- manual override rehearsal
- property admin parking assignment rehearsal
- demo data for vehicles and spots

**Implementation Notes**
- Treat this as the release gate for the parking MVP slice

**Definition of Done**
- Parking tests pass at MVP gate level
- Demo data exists
- End-to-end resident/security/admin parking flows have been rehearsed

**Dependencies**
- `PKMVP-08`
- `PKMVP-09`
- `PKMVP-10`
- `PKMVP-11`

**Out of Scope**
- Production-scale parking ops
- Large vendor rollout

---

## Recommended Execution Order

1. `PKMVP-01`
2. `PKMVP-02`
3. `PKMVP-03`
4. `PKMVP-04`
5. `PKMVP-05`
6. `PKMVP-06`
7. `PKMVP-07`
8. `PKMVP-08`, `PKMVP-09`, `PKMVP-10`
9. `PKMVP-11`
10. `PKMVP-12`

## Release Gate Mapping

- `Gate A - Scope Freeze`
  - `PKMVP-01`

- `Gate B - Domain Ready`
  - `PKMVP-02`
  - `PKMVP-03`
  - `PKMVP-04`
  - `PKMVP-05`
  - `PKMVP-06`
  - `PKMVP-07`

- `Gate C - UI Ready`
  - `PKMVP-08`
  - `PKMVP-09`
  - `PKMVP-10`

- `Gate D - Pilot Ready`
  - `PKMVP-11`
  - `PKMVP-12`
