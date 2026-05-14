---
name: domhub-spec-writer
description: Use when planning or documenting DomHub platform features, roles, workflows, rollout decisions, acceptance criteria, or backlog items. Keeps product work aligned with the DomHub source-of-truth specs before implementation.
license: project-local
metadata:
  domain: product
  project: DomHub
  source: project-local
---

# DomHub Spec Writer

Use this skill before writing new product specs, acceptance criteria, rollout plans, roadmap updates, or feature briefs for DomHub.

## Source Of Truth

Read the smallest relevant set first:

- `docs/product/specs/domhub-final-product-plan.md` is the master product roadmap and specification.
- Delivery planning:
  - `docs/product/specs/domhub-backlog-epics.md`
  - `docs/product/specs/domhub-technical-streams-plan.md`
  - `docs/product/specs/domhub-12-week-sprint-plan.md`
  - `docs/product/specs/domhub-work-breakdown.md`
- Short execution guidance:
  - `IMPLEMENTATION_ORDER.md`
  - `ACCESS_SOURCE_OF_TRUTH.md`
- Platform module details live under `docs/product/specs/platform-v1/`.

## Workflow

1. Identify which role, module, workflow, or rollout phase the request touches.
2. Check the master plan first, then only the relevant platform-v1 or delivery document.
3. Preserve the existing product vocabulary: property, resident, security, concierge, technician, contractor, property admin, management company admin, tenant isolation, platform-v1.
4. Keep new scope consistent with staged rollout and feature-gating decisions.
5. Write specs as implementable contracts: states, permissions, data shape, API implications, frontend views, acceptance criteria, tests, migration impact, and rollout risk.

## Guardrails

- Do not invent product modules that bypass the roadmap unless the user explicitly overrides the source-of-truth documents.
- Do not treat deprecated `/api/*` aliases as canonical contracts.
- Separate bulk initial sync from incremental SSE updates in workflow descriptions.
- Call out tenant isolation, auditability, privacy, and operational readiness whenever the feature touches residents, access, passes, staff, requests, uploads, notifications, or sensitive actions.

