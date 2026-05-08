# DomHub Product Specs Index

This directory contains the working product source of truth for DomHub platform development.

## Primary Document

- `domhub-final-product-plan.md`
  - Master roadmap/specification for the target product, final platform shape, phase order, release gates, risks, and success metrics.

## Supporting Planning Documents

- `domhub-access-platform-final-plan.md`
  - Master specification and staged development plan for DomHub as an access-control platform for residential complexes and cottage communities.

- `domhub-residential-territory-model-spec.md`
  - Source-of-truth model for supporting residential complexes, club houses, cottage communities, address labels, territory structure, checkpoint-first guard workflows, and v1/v2 data-model boundaries.

- `domhub-russia-production-readiness-spec.md`
  - Source-of-truth readiness spec for Russian production pilots: personal data compliance, resident lifecycle, emergency dispatch, degraded checkpoint operation, GIS ЖКХ / ОСС readiness, hardware integration boundaries, sensitive action audit, and pilot runbooks.

- `domhub-security-threat-model.md`
  - Threat model for tenant isolation, access control, personal data, staff/admin abuse, checkpoint operations, integrations, video evidence, audit, and no-biometrics boundaries.

- `domhub-access-core-production-slice-plan.md`
  - Execution plan for stabilizing the current `rezidence4` access-core slice before further platform expansion: identity mapping, restore/fresh-install drift, strict e2e, backend refactor, role/scope model, v1 cutover, legacy freeze, policy engine, and pilot readiness.

- `platform-v1/README.md`
  - Sub-index for detailed platform-v1 migration and module specs. Use these files for current v1 implementation and migration details; they do not override the master product roadmap.

- `domhub-role-maturity-matrix.md`
  - Role-by-role matrix showing which DomHub actors belong in MVP, strong v2, and mature v3, and which ones should remain support or integration layers instead of full daily workspaces.

- `domhub-commercial-tenant-module-spec.md`
  - Optional mixed-use module specification for commercial tenants or business partners operating inside residential properties.

- `domhub-commercial-tenant-jira-backlog.md`
  - Jira-ready bounded execution backlog for the optional commercial tenant module used in mixed-use residential properties.

- `domhub-commercial-tenant-jira-import.csv`
  - CSV import file for the optional commercial tenant module backlog, with week, team, dependency, and component metadata.

- `domhub-commercial-tenant-jira-import-v2.csv`
  - Extended CSV import file for the optional commercial tenant module backlog, with additional `Definition Of Done` and `Out Of Scope` columns.

- `domhub-commercial-tenant-week-team-plan.md`
  - Practical 3-week mixed-use pilot delivery plan for the optional commercial tenant module, mapped by team, dependencies, and critical path.

- `domhub-mixed-use-objects-strategy.md`
  - Short strategy document explaining when DomHub should enable mixed-use capabilities and when it should keep them disabled.

- `domhub-parking-module-spec.md`
  - Module specification for DomHub parking as a controlled vehicle-access and parking-operations layer rather than a standalone smart-parking product.

- `domhub-missing-docs-priority.md`
  - Docs-health and remaining-gaps list. It tracks missing or incomplete supporting specs and does not override the master plan.

- `domhub-project-implementation-status.md`
  - Audit snapshot comparing the current local codebase against `DH-01` through `DH-61`. It reports implemented, partial, planned, and legacy/prototype areas and does not override the master plan.

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

- `domhub-release-gate-checklists.md`
  - Formal release gate checklists for v2 Core, Operations+, Portfolio-ready, Pilot-To-Production Hardening, Russia Production Readiness, and Expansion Layer.

- `domhub-deployment-and-tenant-ops-spec.md`
  - Deployment, provisioning, migration, rollback, and operational model for DomHub tenants.

- `domhub-operational-runbooks-index.md`
  - Runbook coverage index for property launch, КПП degraded mode, emergency dispatch, resident offboarding, PDn/DSAR handling, support escalation, backup/restore, and pilot support.

- `domhub-integration-architecture-spec.md`
  - Architecture rules for external integrations, adapters, sync models, retries, and multi-tenant integration behavior.

- `domhub-event-taxonomy-spec.md`
  - Canonical event naming and envelope rules for audit, analytics, notifications, integrations, webhooks, release gates, and operational reporting.

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

- `domhub-access-jira-ready-backlog.md`
  - Jira-ready first-wave execution backlog for the DomHub access platform, with ticket summaries, DoD, dependencies, and scope boundaries.

- `domhub-parking-mvp-jira-backlog.md`
  - Jira-ready bounded execution backlog for the first DomHub parking MVP, including vehicle registry, parking spots, parking assignments, guard validation, and parking incidents.

- `domhub-parking-mvp-jira-import.csv`
  - CSV import file for the first DomHub parking MVP backlog, with week, team, dependency, and component metadata.

- `domhub-parking-mvp-jira-import-v2.csv`
  - Extended CSV import file for the first DomHub parking MVP backlog, with additional `Definition Of Done` and `Out Of Scope` columns.

- `domhub-parking-mvp-week-team-plan.md`
  - Practical 2-week execution allocation for the first DomHub parking MVP, mapped by team, dependencies, and critical path.

- `domhub-platform-jira-ready-backlog.md`
  - Jira-ready backlog for the remaining DomHub platform beyond access-core: operations, communications, portfolio, integrations, onboarding, hardening, and expansion modules.

- `domhub-master-jira-backlog.md`
  - Unified master backlog registry for the full DomHub platform from `DH-01` through `DH-61`.

- `domhub-jira-import.csv`
  - CSV backlog structure for Jira import, covering `DH-01` through `DH-61`.

- `domhub-jira-import-v2.csv`
  - Jira-friendly CSV with `Epic Name`, `Sprint`, `Team`, and `Depends On` columns for `DH-01` through `DH-61`.

- `domhub-master-backlog-sprint-team-plan.md`
  - Sprint-by-sprint and team-by-team execution allocation for the full DomHub backlog.

- `domhub-design-tokens-css-spec.md`
  - CSS variable token contract for the DomHub visual system, including color, typography, spacing, motion, and density tokens.

- `domhub-figma-component-library-structure.md`
  - Recommended Figma file, page, naming, and component structure for the DomHub design system and role-specific patterns.

- `domhub-react-figma-component-map.md`
  - Mapping between the first critical DomHub screens, existing React design-system components, planned React components, and their Figma counterparts.

- `domhub-7-day-figma-transition-checklist.md`
  - Practical 7-day checklist for moving DomHub from Claude-led design exploration into a usable Figma Starter workflow and first-wave implementation handoff.

- `domhub-figma-file-template.md`
  - Recommended DomHub Figma file/page/frame template for organizing foundations, components, role screens, and prototype flows in one scalable product file.

- `domhub-claude-design-7-day-prompt-pack.md`
  - Day-by-day Claude Design prompt pack for shaping the first DomHub visual direction, screens, critiques, and handoff readiness.

- `domhub-figma-project-copy-paste-outline.md`
  - Ready-to-paste outline for the initial DomHub Figma file, including pages, first frames, first components, screen order, and contribution rules.

- `domhub-figma-ai-make-prompt-pack.md`
  - Prompt pack for Figma AI and Figma Make to generate DomHub foundations, critical screens, flows, and review passes in a controlled first-wave scope.

- `domhub-ultra-short-figma-starter-sheet.md`
  - Minimal starter sheet for spinning up the first DomHub Figma file with only the essential pages, components, screens, labels, and week-one goal.

- `domhub-unified-design-workflow-pack.md`
  - End-to-end workflow guide for using Claude Design, Figma AI, Figma Make, and Claude Code together without design or implementation drift.

- `domhub-first-working-mvp-checklist.md`
  - Practical master checklist of what still must be completed before DomHub reaches a first working MVP and pilot-capable core slice.

- `domhub-first-working-mvp-jira-backlog.md`
  - Jira-ready bounded execution backlog for the first working DomHub MVP, including scope freeze, design freeze, core slice, infra baseline, and pilot readiness tickets.

- `domhub-first-working-mvp-jira-import.csv`
  - CSV import file for the first working DomHub MVP backlog, with week, team, dependency, and component metadata.

- `domhub-first-working-mvp-jira-import-v2.csv`
  - Extended CSV import file for the first working DomHub MVP backlog, with additional `Definition Of Done` and `Out Of Scope` columns.

- `domhub-first-working-mvp-week-team-plan.md`
  - Practical 3-week execution allocation for the first working DomHub MVP, mapped by team, dependencies, and critical path.

- `domhub-technical-streams-plan.md`
  - Stream-based technical plan for backend, frontend, data, integrations, legal/compliance, and operations.

- `domhub-12-week-sprint-plan.md`
  - Suggested 12-week execution plan for delivering the strong v2 core and portfolio-ready baseline.

- `domhub-work-breakdown.md`
  - Work breakdown to `database / API / UI / tests / docs` level.

- `domhub-ui-screen-map.md`
  - Role-by-role UI screen map for resident, security, concierge, technician, contractor, property admin, management company admin, and platform admin surfaces.

## Optional / Reference Groups

- Parking, commercial tenant, first working MVP, and Figma/design documents are optional/reference planning groups. They remain useful when their module is in scope, but they do not override `domhub-final-product-plan.md`.
- `platform-v1/*` files are detailed implementation and migration specs covered by `platform-v1/README.md`; the root index intentionally links the sub-index instead of listing every module file.

## Usage Guidance

- When implementing new DomHub platform features, start with `domhub-final-product-plan.md`.
- When a feature touches ЖК vs cottage-community behavior, address labels, property structure, checkpoint/guard mode, or onboarding imports, also use `domhub-residential-territory-model-spec.md`.
- When a feature touches Russian production readiness, ПДн, resident offboarding, emergency dispatch, degraded КПП mode, GIS ЖКХ / ОСС documents, hardware devices, video evidence, or sensitive action audit, also use `domhub-russia-production-readiness-spec.md`.
- When a feature changes tenant isolation, role/scope, sensitive data, access decisions, integrations, video evidence, audit, or staff/admin sensitive actions, also use `domhub-security-threat-model.md`.
- When implementing or refining access-control features, also use `domhub-access-platform-final-plan.md`.
- When deciding which roles deserve full product workspaces versus support-only or integration-first treatment, also use `domhub-role-maturity-matrix.md`.
- When planning mixed-use properties with salons, clinics, cafes, shops, or other on-site businesses, also use `domhub-commercial-tenant-module-spec.md`.
- When planning execution for the optional commercial tenant module, also use `domhub-commercial-tenant-jira-backlog.md`.
- When importing the optional commercial tenant module into Jira, also use `domhub-commercial-tenant-jira-import.csv`.
- When you need commercial tenant Jira import with richer execution metadata, also use `domhub-commercial-tenant-jira-import-v2.csv`.
- When coordinating a mixed-use pilot wave by week and team, also use `domhub-commercial-tenant-week-team-plan.md`.
- When deciding whether mixed-use should be enabled on a property at all, also use `domhub-mixed-use-objects-strategy.md`.
- When implementing vehicle access, parking spots, or parking operations, also use `domhub-parking-module-spec.md`.
- When implementing access-domain backend or database work, also use `domhub-access-data-model-spec.md`.
- When implementing access rules, state transitions, or APIs, also use:
  - `domhub-access-policy-spec.md`
  - `domhub-state-machines-spec.md`
  - `domhub-access-api-contract-spec.md`
- When implementing QA or platform operations, also use:
  - `domhub-test-strategy-spec.md`
  - `domhub-deployment-and-tenant-ops-spec.md`
  - `domhub-release-gate-checklists.md`
  - `domhub-operational-runbooks-index.md`
- When implementing integrations, analytics, or package/feature rollout, also use:
  - `domhub-integration-architecture-spec.md`
  - `domhub-event-taxonomy-spec.md`
  - `domhub-analytics-metric-definitions.md`
  - `domhub-packaging-and-feature-gating-spec.md`
- When implementing vendor-specific access/video/ERP integrations, also use:
  - `domhub-skud-vendor-priority-spec.md`
  - `domhub-video-integration-spec.md`
  - `domhub-erp-1c-integration-spec.md`
- When deciding priority or order, use `domhub-backlog-epics.md` and `domhub-12-week-sprint-plan.md`.
- When checking what has already been implemented versus what remains, use `domhub-project-implementation-status.md` as a current audit snapshot, then verify against code/tests before treating an item as release-ready.
- When creating implementation tickets, use `domhub-access-jira-ready-backlog.md`.
- When creating parking-only MVP implementation tickets, use `domhub-parking-mvp-jira-backlog.md`.
- When creating non-access implementation tickets, use `domhub-platform-jira-ready-backlog.md`.
- When you need one unified execution view, use `domhub-master-jira-backlog.md`.
- When preparing Jira import, use `domhub-jira-import.csv`.
- When preparing Jira import with execution metadata, prefer `domhub-jira-import-v2.csv`.
- When planning delivery by sprint and team, use `domhub-master-backlog-sprint-team-plan.md`.
- When building the visual system in code, use `domhub-design-tokens-css-spec.md`.
- When organizing the Figma library and component taxonomy, use `domhub-figma-component-library-structure.md`.
- When translating first critical screens from Figma into React, use `domhub-react-figma-component-map.md`.
- When setting up the first week of Figma work from the existing DomHub docs and token specs, use `domhub-7-day-figma-transition-checklist.md`.
- When creating the actual Figma file structure and first page/frame template, use `domhub-figma-file-template.md`.
- When running the first week of Claude Design exploration and critique, use `domhub-claude-design-7-day-prompt-pack.md`.
- When you want a direct copy-paste setup outline for the Figma file, use `domhub-figma-project-copy-paste-outline.md`.
- When generating the first DomHub screens and flows with Figma AI or Figma Make, use `domhub-figma-ai-make-prompt-pack.md`.
- When you need the shortest possible Figma startup sheet, use `domhub-ultra-short-figma-starter-sheet.md`.
- When coordinating work across Claude Design, Figma AI, Figma Make, and Claude Code, use `domhub-unified-design-workflow-pack.md`.
- When deciding what is still missing before the first real working MVP, use `domhub-first-working-mvp-checklist.md`.
- When planning or importing only the first real MVP delivery wave into Jira, use `domhub-first-working-mvp-jira-backlog.md`.
- When importing the first working MVP delivery wave into Jira, use `domhub-first-working-mvp-jira-import.csv`.
- When you need MVP Jira import with richer execution metadata, use `domhub-first-working-mvp-jira-import-v2.csv`.
- When coordinating the first working MVP by week and team, use `domhub-first-working-mvp-week-team-plan.md`.
- When importing the first parking MVP delivery wave into Jira, use `domhub-parking-mvp-jira-import.csv`.
- When you need parking MVP Jira import with richer execution metadata, use `domhub-parking-mvp-jira-import-v2.csv`.
- When coordinating the first parking MVP by week and team, use `domhub-parking-mvp-week-team-plan.md`.
- When decomposing engineering work, use `domhub-technical-streams-plan.md` and `domhub-work-breakdown.md`.
- When planning role-specific UI surfaces, use `domhub-ui-screen-map.md` alongside the design/Figma documents.
- If the user gives instructions that conflict with these files, follow the user and then update the docs accordingly.
