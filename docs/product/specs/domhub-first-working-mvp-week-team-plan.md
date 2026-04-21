# DomHub First Working MVP Week And Team Plan

This document maps the first working MVP backlog to a practical 3-week execution plan and team allocation.

It assumes:

- the planning/specification layer already exists;
- scope remains frozen;
- the team works in parallel where safe;
- no new non-MVP modules are introduced during the MVP push.

## Planning Model

- Duration: 3 weeks
- Mode: aggressive but realistic MVP delivery
- Strategy:
  - Week 1 = freeze scope and freeze design while foundations start
  - Week 2 = finish backend core and expose the contract layer
  - Week 3 = complete the frontend vertical slice, hardening, and pilot rehearsal

## Team Model

- `Product And Design`
  - scope freeze
  - Figma source of truth
  - screen annotations
  - first-wave visual freeze

- `Platform Backend`
  - domain entities
  - services
  - `/api/v1/*`
  - authorization
  - request/access lifecycle

- `Frontend App`
  - shared UI primitives
  - resident flows
  - security workspace
  - staff queue
  - property admin dashboard

- `Data And Infra`
  - schema
  - migrations
  - staging support
  - environment/config readiness

- `Integrations`
  - notification abstraction
  - CSV import
  - mock integration path

- `QA And Release`
  - smoke and regression gates
  - E2E verification
  - release confidence

- `Ops And Enablement`
  - launch notes
  - pilot onboarding
  - support notes
  - demo data and rehearsal support

## Critical Path

The MVP critical path is:

1. `MVP-01`
2. `MVP-08`
3. `MVP-09`
4. `MVP-10`
5. `MVP-11`
6. `MVP-12`
7. `MVP-13`
8. `MVP-14`
9. `MVP-15`
10. `MVP-16`, `MVP-17`, `MVP-18`
11. `MVP-20`

The design freeze work in `MVP-02` through `MVP-07` runs in parallel and feeds `MVP-15` through `MVP-18`.

## Week 1

**Goal**
Freeze the MVP, create the Figma source of truth, and establish the backend foundations.

**Primary Teams**
- Product And Design
- Platform Backend
- Data And Infra

**Tickets**
- `MVP-01`
- `MVP-02`
- `MVP-03`
- `MVP-04`
- `MVP-05`
- `MVP-06`
- `MVP-07`
- `MVP-08`
- `MVP-09`

**Expected Output**
- frozen MVP scope;
- first Figma file and first implementation-ready screens;
- tenant/property/role foundations working in backend;
- no ambiguity about what is in and out of MVP.

**Support**
- QA And Release:
  - migration smoke checks
  - auth boundary smoke checks

**Risk Notes**
- If `MVP-01` slips, everything expands uncontrollably.
- If `MVP-04` through `MVP-07` slip, frontend work in Week 2 and Week 3 becomes guesswork.

## Week 2

**Goal**
Finish backend core, expose the API contract, and start shared frontend primitives.

**Primary Teams**
- Platform Backend
- Data And Infra
- Frontend App

**Tickets**
- `MVP-10`
- `MVP-11`
- `MVP-12`
- `MVP-13`
- `MVP-14`
- `MVP-15`

**Expected Output**
- resident, staff, vehicle, access, incident, and request domain baseline working;
- MVP `/api/v1/*` contract exposed and permissioned;
- shared frontend shell components ready;
- frontend can begin binding to real contracts instead of assumptions.

**Support**
- QA And Release:
  - integration test baseline
  - route permission checks

**Risk Notes**
- `MVP-14` is the gateway ticket for the entire frontend vertical slice.
- If `MVP-15` is weak, Week 3 turns into duplicated page code.

## Week 3

**Goal**
Complete the end-to-end UI slice, add basic notifications/import, and rehearse the MVP as a pilot-ready product.

**Primary Teams**
- Frontend App
- QA And Release
- Integrations
- Ops And Enablement

**Tickets**
- `MVP-16`
- `MVP-17`
- `MVP-18`
- `MVP-19`
- `MVP-20`

**Expected Output**
- resident guest and vehicle flows work end to end;
- security allow/deny/manual override works end to end;
- staff request queue works;
- property admin dashboard works;
- notifications and CSV import baseline exists;
- staging, demo data, and pilot rehearsal are complete.

**Support**
- Platform Backend:
  - bug fixing
  - response contract stabilization
- Data And Infra:
  - staging and migration reliability

**Risk Notes**
- `MVP-20` should be treated as a release gate, not as a cleanup wish list.
- If the pilot rehearsal is skipped, the MVP may still be technically working but operationally unready.

## Parallelization Rules

- Product and design can run in parallel with backend foundations in Week 1.
- Backend core and shared frontend primitives can run in parallel in Week 2 after the first Figma freeze.
- Resident, security, and admin frontend slices can run in parallel in Week 3 if shared components are stable.
- Notifications/import can run in parallel with frontend page completion.
- Pilot readiness tasks can begin before all UI polish is complete, but only after the core slice is truly working.

## Cross-Team Dependencies

### Product And Design -> Frontend App

- Figma screens and annotations must exist before UI implementation starts in earnest.

### Platform Backend -> Frontend App

- Frontend depends on `MVP-14` for stable route shape and permissions.

### Data And Infra -> Platform Backend

- Backend velocity depends on clean migrations and staging reliability.

### Integrations -> Frontend App And Ops

- Notification and import baseline affects pilot realism and onboarding confidence.

### QA And Release -> Everyone

- QA gates should not be deferred to the final day.

## Minimum Weekly Review Questions

### End Of Week 1

- Is MVP scope frozen?
- Is Figma now a usable visual source of truth?
- Are tenant/property/role foundations stable?

### End Of Week 2

- Do MVP APIs exist and enforce scope correctly?
- Are core lifecycle rules working?
- Are shared frontend primitives good enough to prevent screen duplication?

### End Of Week 3

- Do resident, security, staff, and property admin flows work end to end?
- Are tests and staging good enough for a real pilot rehearsal?
- Can the team demo the product without inventing missing behavior on the fly?

## Compression Note

This backlog can be compressed into 2 weeks only if:

- the Figma work is mostly already done;
- shared frontend primitives are partly implemented;
- backend foundations already exist in usable form;
- the team accepts elevated risk on polish and pilot rehearsal.

Otherwise, use the 3-week plan above as the default first working MVP push.
