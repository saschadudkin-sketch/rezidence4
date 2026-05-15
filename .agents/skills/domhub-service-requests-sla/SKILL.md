---
name: domhub-service-requests-sla
description: Use when changing DomHub service requests, staff or technician workspace, assignment, SLA profiles, escalation, emergency dispatch, contractor handoff, or request workflow state machines.
license: project-local
metadata:
  domain: service-requests
  project: DomHub
  source: project-local
---

# DomHub Service Requests SLA

Use this skill for service request workflows, SLA logic, staff workspaces, and emergency dispatch.

## Sources

- `docs/product/specs/platform-v1/service-requests-spec.md`
- `docs/product/specs/platform-v1/staff-workspace-spec.md`
- `docs/product/specs/platform-v1/technician-workspace-spec.md`
- `docs/product/specs/platform-v1/emergency-dispatch-readiness-spec.md`
- `docs/product/specs/domhub-state-machines-spec.md`
- backend request/SLA/emergency services and frontend staff/technician pages.

## Rules

- State transitions must be explicit and tested.
- SLA start, pause, breach, escalation, and resolution semantics must be stable.
- Emergency/P0 requests need clear dispatch responsibility and evidence capture.
- Contractor handoff must preserve tenant scope, auditability, and least privilege.
- UI should expose priority, assignee, SLA risk, and next action without hiding blocked states.

## Checks

- Run request workflow and SLA service tests.
- Run frontend staff/technician workspace tests for UI workflow changes.
- Include readiness checks for emergency dispatch behavior changes.

