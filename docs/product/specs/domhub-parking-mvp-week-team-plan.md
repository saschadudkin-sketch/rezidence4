# DomHub Parking MVP Week And Team Plan

This document maps the first working parking MVP backlog to a practical 2-week execution plan and team allocation.

It assumes:

- the current garage/vehicle baseline already exists in the project;
- the parking module remains part of DomHub access and operations;
- no paid parking, booking, ANPR-first, or smart-parking expansion enters the MVP wave.

## Planning Model

- Duration: 2 weeks
- Mode: bounded parking MVP delivery
- Strategy:
  - Week 1 = freeze scope, finish parking domain, expose API surface
  - Week 2 = complete resident/security/admin UI, onboarding, and pilot rehearsal

## Team Model

- `Product And Design`
  - scope freeze
  - parking UX boundaries
  - screen decisions for resident, security, and property admin

- `Platform Backend`
  - parking entities
  - guest vehicle pass logic
  - events and incidents
  - `/api/v1/*`

- `Frontend App`
  - resident parking UI
  - security parking validation UI
  - property admin parking UI

- `Data And Infra`
  - schema
  - migrations
  - environment and staging support

- `Integrations`
  - CSV onboarding baseline
  - future-proof import path for parking data

- `QA And Release`
  - integration tests
  - UI smoke coverage
  - pilot gate verification

- `Ops And Enablement`
  - demo data
  - onboarding notes
  - pilot support flow

## Critical Path

The parking MVP critical path is:

1. `PKMVP-01`
2. `PKMVP-02`
3. `PKMVP-03`
4. `PKMVP-04`
5. `PKMVP-05`
6. `PKMVP-06`
7. `PKMVP-07`
8. `PKMVP-08`, `PKMVP-09`, `PKMVP-10`
9. `PKMVP-12`

`PKMVP-11` can run in parallel with UI completion in Week 2.

## Week 1

**Goal**
Freeze parking MVP scope, establish the parking domain, and expose the parking API.

**Primary Teams**
- Product And Design
- Platform Backend
- Data And Infra

**Tickets**
- `PKMVP-01`
- `PKMVP-02`
- `PKMVP-03`
- `PKMVP-04`
- `PKMVP-05`
- `PKMVP-06`
- `PKMVP-07`

**Expected Output**
- parking MVP scope is frozen;
- parking spots and assignments exist in the domain;
- current vehicle registry is normalized into parking MVP;
- guest vehicle pass backend flow exists;
- parking events and incidents exist;
- `/api/v1/*` parking surface is usable.

**Support**
- QA And Release:
  - migration smoke checks
  - route and permission smoke checks

**Risk Notes**
- If `PKMVP-01` slips, parking will expand into non-MVP smart-parking features.
- If `PKMVP-07` slips, Week 2 UI work becomes guesswork.

## Week 2

**Goal**
Complete the parking UI slice, import baseline, and pilot readiness.

**Primary Teams**
- Frontend App
- QA And Release
- Integrations
- Ops And Enablement

**Tickets**
- `PKMVP-08`
- `PKMVP-09`
- `PKMVP-10`
- `PKMVP-11`
- `PKMVP-12`

**Expected Output**
- resident can manage vehicles and create guest vehicle passes;
- security can validate vehicle access by plate and make decisions;
- property admin can manage parking spots and assignments;
- CSV onboarding exists for parking spots and assignments baseline;
- demo data and pilot rehearsal are complete.

**Support**
- Platform Backend:
  - bug fixes
  - route stabilization
- Data And Infra:
  - staging and migration reliability

**Risk Notes**
- `PKMVP-12` is the real release gate for the parking slice.
- If resident/security/admin flows are not rehearsed together, the module may still be technically complete but operationally weak.

## Parallelization Rules

- `PKMVP-02`, `PKMVP-03`, and `PKMVP-04` can progress in parallel once scope is frozen.
- `PKMVP-05` and `PKMVP-06` can overlap once the domain baseline is stable.
- Resident, security, and admin parking UIs can run in parallel after `PKMVP-07`.
- CSV onboarding can run in parallel with frontend parking UI in Week 2.

## Cross-Team Dependencies

### Product And Design -> Frontend App

- Parking resident/security/admin UX boundaries should be clear before frontend implementation expands.

### Platform Backend -> Frontend App

- Frontend depends on `PKMVP-07` for stable parking routes and permissions.

### Data And Infra -> Platform Backend

- Clean migrations and staging support are required for spot and assignment rollout.

### Integrations -> Ops And Enablement

- CSV onboarding affects whether a pilot object can be loaded without manual parking setup.

### QA And Release -> Everyone

- Test and pilot gates must not be deferred to the final day.

## Minimum Weekly Review Questions

### End Of Week 1

- Is parking MVP scope frozen?
- Do parking spots, assignments, events, and incidents exist?
- Is the parking API stable enough for frontend integration?

### End Of Week 2

- Can resident, security, and property admin complete real parking flows?
- Can parking data be onboarded without manual-only setup?
- Is the parking slice good enough for demo and pilot rehearsal?

## Compression Note

This parking backlog can be compressed into less than 2 weeks only if:

- the current vehicle/garage code is already close to the desired parking model;
- resident parking UI needs only limited adaptation;
- admin parking UI can ship as a lean list-based operational view;
- the team accepts reduced polish and a lighter pilot rehearsal.

Otherwise, use the 2-week plan above as the default parking MVP delivery mode.
