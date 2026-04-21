# DomHub Master Backlog Sprint And Team Plan

This document maps `DH-01` through `DH-54` to sprints and primary delivery teams.

## Planning Model

- Sprint length: 2 weeks
- Horizon: 12 sprints
- Strategy: vertical slices first, then operational depth, then integrations/hardening, then expansion

## Team Model

- `Platform Backend`
  - tenancy, auth, domain services, `/api/v1`, packaging, admin control plane
- `Frontend App`
  - resident, security, staff, contractor, admin, portfolio UI
- `Data And Infra`
  - schema, migrations, tenant ops, aggregation jobs, rollout automation
- `Integrations`
  - notifications, webhooks, SKUD, video, ERP/1C
- `QA And Release`
  - smoke, regression, CI gates, pilot verification
- `Ops And Enablement`
  - onboarding, runbooks, rollout process, support tooling

## Allocation Rules

- Every sprint should have at least one shippable vertical slice.
- `Platform Backend` starts first and stays on the critical path through Sprint 8.
- `Frontend App` ramps up once backend contracts stabilize.
- `Integrations` should start only after core access and event boundaries are stable.
- `QA And Release` begins with smoke coverage, then expands into release gates.

---

## Sprint 1

**Goal**
Establish tenancy, structure, and role model.

**Primary Teams**
- Platform Backend
- Data And Infra

**Tickets**
- `DH-01`
- `DH-02`
- `DH-03`

**Support**
- QA And Release: migration smoke checks

---

## Sprint 2

**Goal**
Add profile domain, vehicles, and physical access topology.

**Primary Teams**
- Platform Backend
- Data And Infra

**Tickets**
- `DH-04`
- `DH-05`
- `DH-06`

**Support**
- QA And Release: schema validation tests

---

## Sprint 3

**Goal**
Complete access persistence and authorization baseline.

**Primary Teams**
- Platform Backend
- Data And Infra

**Tickets**
- `DH-07`
- `DH-08`
- `DH-09`

**Support**
- QA And Release: auth and isolation regression

---

## Sprint 4

**Goal**
Deliver access request lifecycle, pass issuance, vehicle access, and policies.

**Primary Teams**
- Platform Backend

**Tickets**
- `DH-10`
- `DH-11`
- `DH-12`
- `DH-13`
- `DH-14`

**Support**
- Data And Infra: migration and state integrity review

---

## Sprint 5

**Goal**
Ship guard operations and pilot-capable access UI.

**Primary Teams**
- Platform Backend
- Frontend App
- QA And Release

**Tickets**
- `DH-15`
- `DH-16`
- `DH-17`
- `DH-18`
- `DH-19`
- `DH-20`

**Support**
- Ops And Enablement: access pilot checklist

---

## Sprint 6

**Goal**
Start resident service operations: auth hardening, requests, and SLA engine.

**Primary Teams**
- Platform Backend
- Frontend App

**Tickets**
- `DH-21`
- `DH-22`
- `DH-23`
- `DH-24`

**Support**
- QA And Release: request workflow smoke suite

---

## Sprint 7

**Goal**
Deliver staff, technician, contractor, and package workflows.

**Primary Teams**
- Platform Backend
- Frontend App

**Tickets**
- `DH-25`
- `DH-26`
- `DH-27`
- `DH-28`
- `DH-29`
- `DH-30`
- `DH-31`

**Support**
- QA And Release: staff-role regression pack

---

## Sprint 8

**Goal**
Deliver communications, notifications, and management dashboards.

**Primary Teams**
- Platform Backend
- Frontend App
- Integrations

**Tickets**
- `DH-32`
- `DH-33`
- `DH-34`
- `DH-35`
- `DH-36`
- `DH-37`
- `DH-38`
- `DH-39`
- `DH-40`

**Support**
- Ops And Enablement: operational messaging templates

---

## Sprint 9

**Goal**
Build integration and reporting backbone.

**Primary Teams**
- Integrations
- Platform Backend
- Data And Infra

**Tickets**
- `DH-41`
- `DH-42`
- `DH-43`
- `DH-44`
- `DH-45`

**Support**
- QA And Release: adapter and sync test harness

---

## Sprint 10

**Goal**
Make rollout repeatable and production-safe.

**Primary Teams**
- Data And Infra
- Ops And Enablement
- QA And Release

**Tickets**
- `DH-46`
- `DH-47`
- `DH-48`
- `DH-49`

**Support**
- Platform Backend: provisioning hooks
- Frontend App: onboarding polish

---

## Sprint 11

**Goal**
Deliver first post-core expansion modules.

**Primary Teams**
- Platform Backend
- Frontend App

**Tickets**
- `DH-50`
- `DH-51`
- `DH-52`

**Support**
- QA And Release: expansion module regression baseline

---

## Sprint 12

**Goal**
Complete advanced expansion and branding layer.

**Primary Teams**
- Integrations
- Frontend App

**Tickets**
- `DH-53`
- `DH-54`

**Support**
- Ops And Enablement: package and branding rollout rules

---

## Team Ownership Matrix

| Ticket Range | Primary Team | Secondary Teams |
|---|---|---|
| `DH-01` to `DH-16` | Platform Backend | Data And Infra, QA And Release |
| `DH-17` to `DH-20` | Frontend App | Platform Backend, QA And Release, Ops And Enablement |
| `DH-21` to `DH-31` | Platform Backend + Frontend App | QA And Release |
| `DH-32` to `DH-40` | Platform Backend + Frontend App | Integrations, Ops And Enablement |
| `DH-41` to `DH-45` | Integrations | Platform Backend, Data And Infra, QA And Release |
| `DH-46` to `DH-49` | Data And Infra + Ops And Enablement | Platform Backend, Frontend App, QA And Release |
| `DH-50` to `DH-54` | Platform Backend + Frontend App | Integrations, QA And Release |

## Critical Cross-Team Dependencies

- `Frontend App` should not begin major screens until the relevant `/api/v1` contract is stable.
- `Integrations` should not start vendor adapters before `DH-14`, `DH-16`, and `DH-40`.
- `QA And Release` should build smoke suites during Sprints 3 to 5, not only at the end.
- `Ops And Enablement` should start launch docs before Sprint 10, even if final rollout tooling lands there.

## Practical Delivery Advice

- If the team is small, merge `Platform Backend` and `Data And Infra` into one stream.
- If the team is solo, follow the sprint order but execute one backend-first vertical slice at a time.
- If the team is larger, run `Frontend App` and `QA And Release` in parallel starting from Sprint 5.
