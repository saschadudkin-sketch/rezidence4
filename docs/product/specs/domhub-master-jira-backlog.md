# DomHub Master Jira Backlog

This document is the unified execution backlog for DomHub from `DH-01` through `DH-62`.

## Purpose

- Provide one master implementation list for the full DomHub platform
- Keep execution order visible across access, operations, portfolio, integrations, and expansion modules
- Act as the primary ticket registry for planning, sprint slicing, and Jira import preparation

## Source Documents

- `domhub-access-jira-ready-backlog.md`
- `domhub-platform-jira-ready-backlog.md`
- `domhub-final-product-plan.md`
- `domhub-access-platform-final-plan.md`
- `domhub-backlog-epics.md`

## How To Use

- Use this file as the top-level backlog registry.
- Use `domhub-access-jira-ready-backlog.md` for detailed ticket definitions for `DH-01` to `DH-20`.
- Use `domhub-platform-jira-ready-backlog.md` for detailed ticket definitions for `DH-21` to `DH-62`.
- When a ticket changes contracts, policies, state machines, metrics, or deployment behavior, update the corresponding source spec in the same PR.

## Release Gates

- `Core Access Foundation`: `DH-01` to `DH-09`
- `Operational Access Backend`: `DH-10` to `DH-16`
- `Pilot-Capable Access Product`: `DH-17` to `DH-20`
- `Operations-Ready v2`: `DH-21` to `DH-34`
- `Portfolio-Ready v2+`: `DH-35` to `DH-40`
- `Pilot-To-Production Hardening`: `DH-41` to `DH-49`
- `Russia Production Readiness`: `DH-55` to `DH-61`
- `Expansion Layer`: `DH-50` to `DH-54`
- `Legacy Cutover`: `DH-62`

---

## Section A — Access Foundation

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-01` | Tenant Foundation | Add platform-level tenant entities and tenant resolution. | None | Core Access Foundation |
| `DH-02` | Property Structure | Implement `building`, `entrance`, `unit` hierarchy with property-type-aware labels for ЖК, club houses, and cottage communities. | `DH-01` | Core Access Foundation |
| `DH-03` | Memberships And Roles | Add role and membership model across scopes. | `DH-01`, `DH-02` | Core Access Foundation |
| `DH-04` | Profiles Domain | Add resident, staff, and contractor profile entities. | `DH-01`, `DH-02`, `DH-03` | Core Access Foundation |
| `DH-05` | Vehicle Model | Add vehicle entities and ownership/access baseline. | `DH-04` | Core Access Foundation |
| `DH-06` | Access Zones And Points | Implement physical access topology for zones, checkpoints, gates, barriers, doors, and service entries. | `DH-02` | Core Access Foundation |
| `DH-07` | Access Request And Pass Schema | Add request/pass/visit-log schema. | `DH-04`, `DH-05`, `DH-06` | Core Access Foundation |
| `DH-08` | Access Incident And Audit Schema | Add incident and audit entities for access operations. | `DH-07` | Core Access Foundation |
| `DH-09` | Permission Middleware | Enforce role and scope authorization across access routes. | `DH-03`, `DH-04`, `DH-07`, `DH-08` | Core Access Foundation |

---

## Section B — Operational Access Backend

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-10` | Access Request Service | Implement request lifecycle and transitions. | `DH-07`, `DH-09` | Operational Access Backend |
| `DH-11` | Pass Issuance And QR Flow | Implement issued pass generation and public QR flow. | `DH-10` | Operational Access Backend |
| `DH-12` | Vehicle Access Service | Add vehicle-based access handling and visit logging. | `DH-05`, `DH-10`, `DH-11` | Operational Access Backend |
| `DH-13` | Policy And Approval CRUD | Add storage, defaults, and management APIs for zone/point-scoped access policies. | `DH-06`, `DH-07`, `DH-09` | Operational Access Backend |
| `DH-14` | Policy Evaluation Engine | Implement deterministic rule evaluation and wire it into QR/plate verification. | `DH-11`, `DH-12`, `DH-13` | Operational Access Backend |
| `DH-15` | Security Workspace API | Add backend APIs for guard/security console with checkpoint and entry/exit context. | `DH-08`, `DH-11`, `DH-12`, `DH-14` | Operational Access Backend |
| `DH-16` | Manual Override And Incident Flow | Implement point-scoped allow/deny/override actions, visit logs, audit, and incident generation. | `DH-08`, `DH-14`, `DH-15` | Operational Access Backend |

---

## Section C — Pilot-Capable Access Product

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-17` | Resident Access UI | Implement resident guest and vehicle access flows. | `DH-10`, `DH-11`, `DH-12` | Pilot-Capable Access Product |
| `DH-18` | Security Workspace UI | Implement guard-facing console UI, including vehicle-first КПП mode for cottage communities. | `DH-15`, `DH-16` | Pilot-Capable Access Product |
| `DH-19` | Property Admin UI | Implement property admin screens for topology, policies, blacklist/whitelist, and incidents. | `DH-06`, `DH-13`, `DH-16` | Pilot-Capable Access Product |
| `DH-20` | Onboarding, Import, And Smoke E2E | Deliver onboarding, seed/import, planned checkpoint provisioning, and access smoke tests. | `DH-17`, `DH-18`, `DH-19` | Pilot-Capable Access Product |

---

## Section D — Operations And Resident Service

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-21` | Resident Auth And Session Hardening | Harden resident auth, refresh, consent, and session lifecycle. | `DH-03`, `DH-04` | Operations-Ready v2 |
| `DH-22` | Request Categories And Request Core | Implement service request domain for apartments, homes/plots, zones, access points, and common territory. | `DH-04` | Operations-Ready v2 |
| `DH-23` | Request Attachments And Resident Updates | Add attachments and resident-visible request communication. | `DH-22` | Operations-Ready v2 |
| `DH-24` | Assignment, SLA, And Escalation Engine | Add assignment, due dates, SLA, and escalation logic. | `DH-22`, `DH-23` | Operations-Ready v2 |
| `DH-25` | Staff Workspace API | Provide operational APIs for concierge/property admin workflows. | `DH-24` | Operations-Ready v2 |
| `DH-26` | Staff Workspace UI | Implement operations UI for staff users. | `DH-25` | Operations-Ready v2 |
| `DH-27` | Technician Workflow Backend | Add backend workflow for technical specialists. | `DH-24` | Operations-Ready v2 |
| `DH-28` | Technician Workflow UI | Implement technician-facing execution interface. | `DH-27` | Operations-Ready v2 |
| `DH-29` | Contractor Workflow Backend | Extend workflows for external contractors. | `DH-04`, `DH-27`, `DH-16` | Operations-Ready v2 |
| `DH-30` | Contractor Portal UI | Implement minimal external contractor UI. | `DH-29` | Operations-Ready v2 |
| `DH-31` | Packages Domain | Add package intake, notification, and pickup workflow. | `DH-04`, `DH-25` | Operations-Ready v2 |
| `DH-32` | Announcements And Documents Backend | Implement property communication content layer. | `DH-01`, `DH-03` | Operations-Ready v2 |
| `DH-33` | Resident Communications UI | Implement resident announcement and document screens. | `DH-32` | Operations-Ready v2 |
| `DH-34` | Notification Orchestration | Deliver push/SMS/Telegram notification pipeline. | `DH-21`, `DH-22`, `DH-31`, `DH-32` | Operations-Ready v2 |

---

## Section E — Management And Portfolio

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-35` | Property Admin Operational Dashboard | Implement object-level operational dashboard. | `DH-16`, `DH-24`, `DH-34` | Portfolio-Ready v2+ |
| `DH-36` | Management Company Portfolio API | Add company-level aggregated views across properties. | `DH-35` | Portfolio-Ready v2+ |
| `DH-37` | Management Company Portfolio UI | Implement portfolio view for management company admins. | `DH-36` | Portfolio-Ready v2+ |
| `DH-38` | Platform Admin Registry And Property Lifecycle | Implement control plane for client/property management. | `DH-01`, `DH-39` | Portfolio-Ready v2+ |
| `DH-39` | Packaging And Feature Gating Enforcement | Enforce module packaging and feature flags. | `DH-01` | Portfolio-Ready v2+ |
| `DH-40` | Webhooks And Outbound Integration Baseline | Implement outbound integration/event delivery baseline. | `DH-16`, `DH-24`, `DH-34` | Portfolio-Ready v2+ |

---

## Section F — Pilot-To-Production Hardening

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-41` | SKUD Adapter Framework | Create integration framework for access-control vendor adapters. | `DH-14`, `DH-40` | Pilot-To-Production Hardening |
| `DH-42` | SKUD Vendor Integration Wave 1 | Implement first production-priority SKUD integrations. | `DH-41` | Pilot-To-Production Hardening |
| `DH-43` | Video Evidence Integration | Link access/incidents to video evidence context. | `DH-08`, `DH-16`, `DH-41` | Pilot-To-Production Hardening |
| `DH-44` | ERP / 1C / ЖКХ Exchange Baseline | Implement first practical ERP/1C exchange layer. | `DH-20`, `DH-40` | Pilot-To-Production Hardening |
| `DH-45` | Analytics Aggregation Jobs | Implement KPI aggregation and reporting data flow. | `DH-35`, `DH-36` | Pilot-To-Production Hardening |
| `DH-46` | Onboarding Center And Import Wizard | Implement reusable onboarding for units/homes, vehicles, staff, and access topology. | `DH-20`, `DH-38` | Pilot-To-Production Hardening |
| `DH-47` | Deployment And Tenant Ops Automation | Automate tenant provisioning, migrations, and rollback-safe ops. | `DH-38`, `DH-46` | Pilot-To-Production Hardening |
| `DH-48` | Regression E2E And Release Gates | Implement release-blocking test gates for core platform flows. | `DH-18`, `DH-26`, `DH-37`, `DH-46` | Pilot-To-Production Hardening |
| `DH-49` | Pilot Rollout Tooling And Runbooks | Deliver pilot-ready tooling, КПП degraded-mode procedure, and support playbooks. | `DH-46`, `DH-47`, `DH-48` | Pilot-To-Production Hardening |

---

## Section G — Russia Production Readiness

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-55` | Resident Lifecycle And Ownership Changes | Implement owner/resident/tenant/representative lifecycle and offboarding cascades. | `DH-04`, `DH-21` | Russia Production Readiness |
| `DH-56` | RU Personal Data Compliance Controls | Implement consent history, sensitive data classification, DSAR workflow, localization readiness, and no-biometrics guardrail. | `DH-21`, `DH-38`, `DH-48` | Russia Production Readiness |
| `DH-57` | Emergency Dispatch Mode | Implement emergency request behavior with priority, SLA, escalation, and urgent notifications. | `DH-22`, `DH-24`, `DH-26` | Russia Production Readiness |
| `DH-58` | GIS ЖКХ And OSS Readiness | Add document/protocol/export readiness without claiming legal GIS/OSS authority in MVP. | `DH-32`, `DH-33`, `DH-44` | Russia Production Readiness |
| `DH-59` | Hardware Device Registry And Manual-Control Boundaries | Model SKUD, barriers, gates, intercoms, LPR, cameras, and fallback boundaries. | `DH-06`, `DH-41` | Russia Production Readiness |
| `DH-60` | Sensitive Action Audit And Anti-Abuse Reviews | Add reports and review workflows for grants, policy changes, overrides, exports, video access, and provider changes. | `DH-08`, `DH-16`, `DH-35`, `DH-36` | Russia Production Readiness |
| `DH-61` | Pilot Operations And Training Pack | Package first-week support, guard training, emergency drill, offboarding, and PDn support runbooks. | `DH-49`, `DH-55`, `DH-56`, `DH-57` | Russia Production Readiness |

---

## Section H — Expansion Layer

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-50` | Meter Readings Module | Implement meter reading submission and management. | `DH-21`, `DH-46` | Expansion Layer |
| `DH-51` | Billing Records Baseline | Add billing record visibility and finance-linked data model. | `DH-44` | Expansion Layer |
| `DH-52` | Space Booking Module | Implement reservation workflows for shared spaces. | `DH-21`, `DH-39` | Expansion Layer |
| `DH-53` | OCR And Smart Capture | Add OCR-assisted capture where applicable. | `DH-50` | Expansion Layer |
| `DH-54` | White-Label And Branding Expansion | Expand branding controls for customer-facing deployments. | `DH-39` | Expansion Layer |

---

## Section I — Legacy Cutover

| ID | Title | Summary | Depends On | Gate |
|---|---|---|---|---|
| `DH-62` | Legacy Runtime Removal | Remove deprecated `/api/*` aliases, legacy UI/runtime paths, fallback flags, and unmigrated legacy data dependencies after v1 cutover and release gates prove no supported flow depends on them. | `DH-48`, `DH-49`, `DH-50`, `DH-51`, `DH-52`, `DH-55`, `DH-56` | Legacy Cutover |

---

## Recommended Implementation Order

1. `DH-01` to `DH-09`
2. `DH-10` to `DH-16`
3. `DH-17` to `DH-20`
4. `DH-21` to `DH-34`
5. `DH-35` to `DH-40`
6. `DH-41` to `DH-49`
7. `DH-55` to `DH-61`
8. `DH-50` to `DH-54`
9. `DH-62`

## Critical Path

- `DH-01` → `DH-04` → `DH-06` → `DH-07` → `DH-10` → `DH-11` → `DH-13` → `DH-14` → `DH-15` → `DH-16` → `DH-18` → `DH-20`
- `DH-22` → `DH-24` → `DH-25` → `DH-26`
- `DH-35` → `DH-36` → `DH-37`
- `DH-38` → `DH-46` → `DH-47` → `DH-49`
- `DH-55` → `DH-56` → `DH-61`
- `DH-22` → `DH-24` → `DH-57`
- `DH-41` → `DH-59`
- `DH-48` → `DH-49` → `DH-62`

## Notes

- This file is the best single-page backlog view for the whole DomHub program.
- Detailed ticket text remains in:
  - `domhub-access-jira-ready-backlog.md`
  - `domhub-platform-jira-ready-backlog.md`
