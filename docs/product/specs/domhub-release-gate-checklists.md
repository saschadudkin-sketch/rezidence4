# DomHub — Release Gate Checklists

Дата: 2026-05-05
Статус: Draft
Назначение: формальные checklist gates для принятия DomHub от core до production readiness и expansion layer.

---

## 1. Context

Release gates нужны, чтобы не выпускать визуально готовые, но операционно небезопасные фичи. Этот документ связывает master roadmap, Jira backlog, test strategy, runbooks and readiness requirements.

Источники:
- `domhub-final-product-plan.md`;
- `domhub-master-jira-backlog.md`;
- `domhub-test-strategy-spec.md`;
- `domhub-russia-production-readiness-spec.md`;
- `domhub-security-threat-model.md`;
- `domhub-operational-runbooks-index.md`.

---

## 2. Gate Rules

- Gate is blocking unless explicitly waived by product + engineering owner.
- Waiver MUST include reason, risk, owner and follow-up ticket.
- A gate item is done only when implementation, docs and test evidence exist.
- Expansion modules MUST NOT block core release unless enabled for the target tenant.
- The executable matrix is checked with `npm run release:gate:check`; adding,
  removing or renaming release-blocking commands/specs/docs must update
  `scripts/release-gate-matrix.cjs`.

---

## 3. Gate v2 Core

Backlog coverage: `DH-01` through `DH-26`.

Required:
- Multi-tenant foundation works and has tenant isolation tests.
- Property can be created as `residential_complex`, `club_house` or `cottage_community`.
- Role + scope baseline exists for resident, security, staff and property admin.
- Access zones/points, passes, QR, vehicle baseline, guard console and visit logs work through `/api/v1`.
- Requests can be created, targeted and worked from staff baseline UI.
- Emergency category baseline exists.
- Audit is emitted for critical access and admin actions.
- Resident lifecycle and consent baseline are represented or explicitly deferred with risk owner.
- README and master plan link the active source-of-truth docs.

Exit evidence:
- Critical unit/integration tests pass.
- Access/request smoke E2E passes.
- CSV/Jira backlog stays aligned with `DH-01` through `DH-61`.

---

## 4. Gate v2 Operations+

Backlog coverage: `DH-27` through `DH-34` plus operational analytics dependencies.

Required:
- Technician workflow supports assignment, progress, resolution notes and result attachments.
- Contractor workflow is assignment-bound and time-bound.
- Packages, announcements, documents and notifications have operational owner and audit path.
- SLA, overdue, escalation and staff queue behavior are deterministic.
- Object-level analytics show request, SLA, visit, notification and adoption metrics.
- Sensitive-action events are available for later review.

Exit evidence:
- Staff, technician and contractor workflows are test-covered.
- Notification failure and retry behavior is visible.
- Docs describe operational ownership and support escalation.

---

## 5. Gate Portfolio-Ready

Backlog coverage: `DH-35` through `DH-40`.

Required:
- Management company entity and admin role are implemented.
- Cross-property dashboards are scoped to the management company.
- Shared templates/policies do not leak tenant data.
- Platform admin can manage property lifecycle without becoming daily operator.
- Webhooks/outbound integration baseline has retry and error visibility.

Exit evidence:
- Cross-property negative access tests pass.
- Portfolio KPIs map to canonical metric definitions.
- Integration events use the event taxonomy.

---

## 6. Gate Pilot-To-Production Hardening

Backlog coverage: `DH-41` through `DH-49`.

Required:
- SKUD adapter framework exists before vendor-specific rollout.
- Video evidence links incidents/events without native VMS scope.
- ERP/1C/ЖКХ exchange boundaries are documented.
- Onboarding/import wizard can prepare units/homes, residents, staff, vehicles and topology.
- Tenant provisioning, migrations and rollback are documented.
- New tenants can be created through `npm run tenant:provision` without manual
  platform SQL; controlled property migration batches run through
  `npm run tenant:migrate`.
- Restore drill preflight runs through `npm run tenant:restore-drill:preflight`
  and staging/prod-candidate release notes include a full
  `npm run tenant:restore-drill` result against real backups.
- Backend-backed access E2E runs `npm run tenant:preflight:e2e` before
  seeding tenants; failures must identify the missing/unreachable global,
  platform or tenant DB without leaking credentials. Post-migration staging
  gates run `npm run tenant:preflight:current` and must fail when
  platform/property migrations are missing or pending.
- Pilot rollout evidence runs through `npm run pilot:readiness` and links the
  first-week support, checkpoint, emergency, correction and rollback procedures.
- Release-blocking E2E covers resident, guard/security, staff, admin and company flows.
- Pilot rollout runbooks exist.

Exit evidence:
- Adapter contract tests pass.
- Onboarding can be repeated without manual SQL.
- Rollback/support runbook is reviewed.

---

## 7. Gate Russia Production Readiness

Backlog coverage: `DH-55` through `DH-61`.

Required:
- Resident lifecycle handles owner, resident, tenant, representative and legal-entity owner scenarios.
- Offboarding cascades to passes, vehicles, household links, access requests and scopes according to policy, with lifecycle/audit evidence and vehicle review markers.
- Consent history, sensitive data classification, DSAR flow and retention/deletion procedures exist.
- Data localization and ИСПДн readiness assumptions are documented.
- Emergency dispatch mode has priority, SLA, escalation, notification behavior, queue visibility and dispatch/acknowledgement evidence.
- GIS ЖКХ / ОСС readiness is export/readiness only and does not claim legal authority.
- Hardware device registry covers SKUD, barriers/gates, intercoms, LPR and cameras with fallback boundaries.
- Sensitive-action audit/review covers grants, policy changes, overrides, exports, evidence access and provider settings, with assignment, due dates, priority, queue summary, sampling, overdue escalation and anti-abuse hotspot reporting.
- Pilot training pack covers guard/checkpoint, first-week support, emergency drill and PDn escalation.
- No-biometrics-by-default rule is documented and test/release checked.

Exit evidence:
- Russia readiness checklist is complete.
- Executable readiness evidence registration passes through `npm run russia:readiness`.
- Live pilot/staging evidence can be enforced with `npm run russia:readiness -- --require-live`
  once `artifacts/russia-readiness/` contains retained DH-55/DH-56/DH-57/DH-58/DH-59/DH-60 evidence.
- Security threat model is reviewed for target pilot.
- Runbook index links the procedures needed for the pilot.

---

## 8. Gate Expansion Layer

Backlog coverage: `DH-50` through `DH-54`.

Required:
- Expansion module is explicitly enabled by package/feature flag.
- Module does not bypass tenant isolation, role/scope, audit or data retention rules.
- Module docs identify whether it is core, optional or pilot-only.
- Billing/payment/OCR/booking/white-label behavior does not change access/request core contracts.

Exit evidence:
- Module-specific tests pass.
- Feature gate and rollback behavior are documented.
- README or module docs state source-of-truth status.

---

## 9. Acceptance Criteria

- Given a release candidate, when gate review starts, then each enabled gate has an owner, evidence and pass/waive status.
- Given a waived item, when release proceeds, then the waiver has a risk owner and follow-up ticket.
- Given an expansion module is disabled, when core release is reviewed, then expansion checklist is not blocking.
- Given a Russia production pilot, when release is reviewed, then `DH-55` through `DH-61` are included in readiness checks.
