# DomHub — Operational Runbooks Index

Дата: 2026-05-05
Статус: Draft
Назначение: единый индекс runbooks для запуска, поддержки, аварийных сценариев, degraded КПП, resident lifecycle, ПДн and rollback.

---

## 1. Context

DomHub должен быть внедряемым продуктом, а не набором экранов. Для production pilots нужны инструкции, которые отвечают: кто действует, когда действует, где проверяет состояние, как эскалирует и как восстанавливается.

Этот индекс связывает:
- `domhub-deployment-and-tenant-ops-spec.md`;
- `domhub-russia-production-readiness-spec.md`;
- `domhub-release-gate-checklists.md`;
- `platform-v1/go-live-zamoskv-runbook.md`;
- `domhub-master-jira-backlog.md`.

---

## 2. Runbook Status Rules

- `Required` means blocker for production pilot if missing.
- `Recommended` means needed before broader rollout.
- `Module-specific` means needed only when the module is enabled.
- A runbook may initially live inside an existing spec, but must be linked from this index.

---

## 3. Required Runbooks For Production Pilot

| Runbook | Status | Primary owner | Trigger | Linked evidence |
|---|---|---|---|---|
| Property launch | Required | Ops And Enablement | New property onboarding | `docs/runbooks/pilot-rollout.md` |
| Tenant provisioning and migration | Required | Data And Infra | New tenant or migration | `domhub-deployment-and-tenant-ops-spec.md`, `docs/runbooks/pilot-rollout.md` |
| Resident import and activation | Required | Ops And Enablement | Before resident rollout | `docs/runbooks/pilot-rollout.md` |
| Resident lifecycle/offboarding | Required | Property Admin / Support | Move-out, sale, lease end, correction | `docs/runbooks/pilot-rollout.md`, `docs/runbooks/pilot-operations-training-pack.md` |
| Guard/checkpoint training | Required | Ops And Enablement | Before КПП go-live | `docs/runbooks/pilot-rollout.md`, `docs/runbooks/pilot-operations-training-pack.md` |
| КПП degraded mode | Required | Security Lead / Support | Connectivity loss or provider outage | `docs/runbooks/pilot-rollout.md` |
| Emergency dispatch | Required | Property Admin / Concierge Lead | P0/P1 emergency request | `docs/runbooks/pilot-rollout.md`, `docs/runbooks/pilot-operations-training-pack.md` |
| Data correction | Required | Support / Property Admin | Wrong unit, resident, vehicle or membership data | `docs/runbooks/pilot-rollout.md` |
| PDn/DSAR handling | Required | Legal/Ops / Support | Export/delete/correct/restrict request | `domhub-russia-production-readiness-spec.md`, `docs/runbooks/pilot-operations-training-pack.md` |
| Incident escalation | Required | Support / Engineering | Security, access, data or platform incident | `docs/runbooks/pilot-rollout.md` |
| Backup/restore and rollback | Required | Data And Infra | Failed deployment, migration or tenant issue | `docs/runbooks/restore-drill.md`, `docs/runbooks/pilot-rollout.md` |
| First-week pilot support | Required | Ops And Enablement | First live property week | `docs/runbooks/pilot-rollout.md`, `docs/runbooks/pilot-operations-training-pack.md` |
| Pilot operations training pack | Required | Ops And Enablement / QA And Release | Before Russia production readiness sign-off | `docs/runbooks/pilot-operations-training-pack.md`, `platform-v1/pilot-operations-training-pack-spec.md` |

---

## 4. Recommended Runbooks

| Runbook | Status | Primary owner | Trigger |
|---|---|---|---|
| Integration provider outage | Recommended | Integrations | SKUD/video/ERP/notification failure |
| Video evidence handling | Recommended | Property Admin / Security Lead | Incident review |
| Sensitive-action review | Recommended | Property Admin | Weekly/monthly access review |
| Release gate review | Recommended | QA And Release | Release candidate |
| Management company onboarding | Recommended | Ops And Enablement | Multi-property rollout |
| Support handoff | Recommended | Ops And Enablement | New customer support launch |

---

## 5. Module-Specific Runbooks

| Runbook | Required when |
|---|---|
| Parking operations | Parking module enabled |
| Commercial tenant onboarding | Commercial tenant module enabled |
| Meter reading cycle | Meter readings enabled |
| Billing import/review | Billing records enabled |
| Booking operations | Space booking enabled |
| White-label rollout | White-label enabled |

---

## 6. Minimum Runbook Template

Each runbook SHOULD include:
- purpose and trigger;
- owner and backup owner;
- prerequisites;
- step-by-step procedure;
- checks/queries/screens to verify state;
- escalation path;
- rollback or recovery path;
- audit/logging expectations;
- resident/staff communication notes;
- linked tickets/specs.

---

## 7. Acceptance Criteria

- Given a production pilot is planned, when readiness is reviewed, then all Required runbooks have an owner and linked document.
- Given КПП loses connectivity, when security follows degraded-mode runbook, then manual actions can later be reconciled.
- Given a resident leaves a property, when offboarding runbook is followed, then passes, vehicles, memberships and notification scope are reviewed.
- Given a PDn request is received, when support follows the DSAR runbook, then request status and resolution are auditable.
- Given a migration fails, when rollback runbook is triggered, then tenant data and platform registry responsibilities are clear.

---

## 8. Current Linked Runbooks

- `platform-v1/go-live-zamoskv-runbook.md` — first production tenant go-live reference.
- `docs/runbooks/pilot-rollout.md` — pilot go/no-go, first-week support,
  checkpoint, incident, correction and rollback wrapper.
- `docs/runbooks/pilot-operations-training-pack.md` — DH-61 training and
  sign-off package for support, guard/checkpoint, emergency, offboarding and
  PDn/DSAR workflows.
- `domhub-deployment-and-tenant-ops-spec.md` — tenant provisioning, migrations, rollback and operational model.
- `domhub-russia-production-readiness-spec.md` — required runbook topics for Russia readiness.

Dedicated runbook files may be added later, but this index is the source of truth for required coverage.
