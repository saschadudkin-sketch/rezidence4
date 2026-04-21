# DomHub Product Specs Index

This directory contains the working product source of truth for DomHub platform development.

## Primary Document

- `domhub-final-product-plan.md`
  - Master roadmap/specification for the target product, final platform shape, phase order, release gates, risks, and success metrics.

## Supporting Planning Documents

- `domhub-access-platform-final-plan.md`
  - Master specification and staged development plan for DomHub as an access-control platform for residential complexes and cottage communities.

- `domhub-missing-docs-priority.md`
  - Prioritized list of missing documents required to move DomHub from planning-ready to production-grade engineering readiness.

- `domhub-access-data-model-spec.md`
  - ERD/data model source of truth for DomHub as an access-control platform.

- `domhub-access-policy-spec.md`
  - Policy engine and rules specification for access types, zones, points, approvals, overrides, and incidents.

- `domhub-state-machines-spec.md`
  - State-transition source of truth for access requests, passes, incidents, and service workflows.

- `domhub-access-api-contract-spec.md`
  - Contract-level API specification for the access platform before full OpenAPI detailing.

- `domhub-test-strategy-spec.md`
  - Test strategy source of truth for multi-tenant platform, access-domain, roles, policies, and release gates.

- `domhub-deployment-and-tenant-ops-spec.md`
  - Deployment, provisioning, migration, rollback, and operational model for DomHub tenants.

- `domhub-integration-architecture-spec.md`
  - Architecture rules for external integrations, adapters, sync models, retries, and multi-tenant integration behavior.

- `domhub-analytics-metric-definitions.md`
  - Canonical definitions of KPI and operational metrics for dashboards, exports, and portfolio views.

- `domhub-packaging-and-feature-gating-spec.md`
  - Product packaging model and feature-flag strategy for DomHub modules and rollout tiers.

- `domhub-skud-vendor-priority-spec.md`
  - Priority order and rollout depth for Russian access-control vendor integrations.

- `domhub-video-integration-spec.md`
  - Specification for linking access events and incidents to video evidence and camera context.

- `domhub-erp-1c-integration-spec.md`
  - Specification for ERP/1C/ЖКХ data exchange, source-of-truth boundaries, and rollout stages.

- `domhub-backlog-epics.md`
  - Product backlog organized by epics, priorities, dependencies, and definition of done.

- `domhub-technical-streams-plan.md`
  - Stream-based technical plan for backend, frontend, data, integrations, legal/compliance, and operations.

- `domhub-12-week-sprint-plan.md`
  - Suggested 12-week execution plan for delivering the strong v2 core and portfolio-ready baseline.

- `domhub-work-breakdown.md`
  - Work breakdown to `database / API / UI / tests / docs` level.

## Legacy / Higher-Level Reference

- `platform-spec.md`
  - Shorter platform summary document. Use the newer files above for detailed delivery and planning decisions.

## Usage Guidance

- When implementing new DomHub platform features, start with `domhub-final-product-plan.md`.
- When implementing or refining access-control features, also use `domhub-access-platform-final-plan.md`.
- When implementing access-domain backend or database work, also use `domhub-access-data-model-spec.md`.
- When implementing access rules, state transitions, or APIs, also use:
  - `domhub-access-policy-spec.md`
  - `domhub-state-machines-spec.md`
  - `domhub-access-api-contract-spec.md`
- When implementing QA or platform operations, also use:
  - `domhub-test-strategy-spec.md`
  - `domhub-deployment-and-tenant-ops-spec.md`
- When implementing integrations, analytics, or package/feature rollout, also use:
  - `domhub-integration-architecture-spec.md`
  - `domhub-analytics-metric-definitions.md`
  - `domhub-packaging-and-feature-gating-spec.md`
- When implementing vendor-specific access/video/ERP integrations, also use:
  - `domhub-skud-vendor-priority-spec.md`
  - `domhub-video-integration-spec.md`
  - `domhub-erp-1c-integration-spec.md`
- When deciding priority or order, use `domhub-backlog-epics.md` and `domhub-12-week-sprint-plan.md`.
- When decomposing engineering work, use `domhub-technical-streams-plan.md` and `domhub-work-breakdown.md`.
- If the user gives instructions that conflict with these files, follow the user and then update the docs accordingly.
