# DomHub Platform Jira-Ready Backlog

This document covers the remaining implementation backlog after the first-wave access/core tickets in `domhub-access-jira-ready-backlog.md`.

## Scope

- Focus: non-access-core platform work required to reach a pilot-capable and then market-strong DomHub platform
- Coverage: operations, communications, portfolio management, integrations, analytics, onboarding, deployment, and expansion modules
- Ticket style: one ticket = one bounded PR-sized delivery slice

## Primary Inputs

- `domhub-final-product-plan.md`
- `domhub-backlog-epics.md`
- `domhub-technical-streams-plan.md`
- `domhub-work-breakdown.md`
- `domhub-integration-architecture-spec.md`
- `domhub-analytics-metric-definitions.md`
- `domhub-packaging-and-feature-gating-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`
- `domhub-access-jira-ready-backlog.md`

## Relationship To Access Backlog

- `DH-01` to `DH-20` in the access backlog create the foundation for this document.
- Tickets below start at `DH-21` and assume the access/core layer is either complete or far enough along to support dependent modules.

## Ticket Rules

- Keep `/api/v1/*` as the source of truth for contracts.
- Keep routes thin and move business logic into services/helpers.
- If a ticket changes metrics, policies, state machines, or deployment model, update the corresponding spec in the same PR.
- Do not mix platform admin, resident UX, and vendor integration work in one ticket unless explicitly stated.

---

## Operations And Resident Service

### DH-21 Resident Auth And Session Hardening

**Summary**
Harden resident authentication, refresh, consent, and secure session lifecycle.

**Scope**
- Align auth/session behavior with current backend/runtime model
- Add consent checkpoints and notification preference baseline
- Add tests for login, refresh, logout, and expired sessions

**Definition of Done**
- Resident auth is stable across refresh and logout flows
- Consent and preference fields are persisted and enforced where needed
- Critical auth paths are covered by tests

**Dependencies**
- `DH-03`
- `DH-04`

**Out of Scope**
- Social login
- Marketing email preferences

---

### DH-22 Request Categories And Request Core

**Summary**
Implement service request domain beyond access workflows.

**Scope**
- Request categories and request types
- Resident/staff request creation
- Request status baseline
- Request detail model and APIs

**Definition of Done**
- Requests can be created and retrieved through `/api/v1`
- Request categories are configurable per property
- Tests cover creation, retrieval, and status baseline

**Dependencies**
- `DH-04`

**Out of Scope**
- SLA and assignment automation
- Technician-specific workflow

---

### DH-23 Request Attachments And Resident Updates

**Summary**
Add attachments and resident-visible communication layer for requests.

**Scope**
- Request attachments
- Resident-visible updates/comments
- Validation for upload references and visibility rules

**Definition of Done**
- Attachments can be associated to requests safely
- Resident-visible comments are clearly separated from internal comments
- Tests cover visibility and invalid attachment flows

**Dependencies**
- `DH-22`

**Out of Scope**
- Internal-only comments
- Rich media galleries

---

### DH-24 Assignment, SLA, And Escalation Engine

**Summary**
Turn requests into managed operational workflows.

**Scope**
- Assignee model
- SLA configuration by category/type
- Due-date, overdue, escalation rules
- First-response and resolution timestamps

**Definition of Done**
- Requests can be assigned and tracked against SLA
- Overdue logic is deterministic and test-covered
- Escalation events are emitted or persisted for downstream consumers

**Dependencies**
- `DH-22`
- `DH-23`

**Out of Scope**
- Company-level SLA reporting UI

---

### DH-25 Staff Workspace API

**Summary**
Provide operational APIs for concierge/property admin request handling.

**Scope**
- Unified inbox
- Request list filters
- Overdue queues
- Resident quick view
- Internal comments baseline

**Definition of Done**
- Staff can load and filter operational queues via API
- Internal comments are stored separately from resident-visible updates
- Tests cover queue filtering and access scope

**Dependencies**
- `DH-24`

**Out of Scope**
- Final staff UI
- Technician specialization queue

---

### DH-26 Staff Workspace UI

**Summary**
Implement core operations UI for concierge and property admin.

**Scope**
- Unified inbox screen
- Request list/filter UI
- Request detail workspace
- Internal notes and quick actions

**Definition of Done**
- Staff can work daily request operations from one interface
- UI is mobile-friendly enough for operational use
- Tests cover major queue and detail workflows

**Dependencies**
- `DH-25`

**Out of Scope**
- Portfolio dashboards
- Technician UI

---

### DH-27 Technician Workflow Backend

**Summary**
Add backend workflow for technical specialists.

**Scope**
- Technician queue
- Technician statuses
- Specialization field
- Resolution notes and result photos

**Definition of Done**
- Technician can take work, progress it, and resolve it
- Status transitions are enforced and tested
- Work output fields are persisted correctly

**Dependencies**
- `DH-24`

**Out of Scope**
- Technician UI
- Contractor delegation

---

### DH-28 Technician Workflow UI

**Summary**
Implement technician-facing request execution interface.

**Scope**
- Assigned requests
- Status updates
- Resolution notes
- Result photo attachments

**Definition of Done**
- Technician can complete primary workflow from UI
- Status and assignment state stay consistent with backend
- Tests cover main execution path

**Dependencies**
- `DH-27`

**Out of Scope**
- Workload analytics dashboard

---

### DH-29 Contractor Workflow Backend

**Summary**
Extend request and access workflows for external contractors.

**Scope**
- Contractor assignment linkage
- External work status flow
- Contractor-specific visibility and access scope
- Link between request execution and contractor access

**Definition of Done**
- Contractor work can be assigned and tracked separately from internal staff
- Contractor only sees scoped tasks/data
- Tests cover contractor visibility boundaries

**Dependencies**
- `DH-04`
- `DH-27`
- `DH-16`

**Out of Scope**
- Contractor portal UI
- Billing with contractor companies

---

### DH-30 Contractor Portal UI

**Summary**
Implement minimal external contractor UI for assigned work.

**Scope**
- Assigned job list
- Job detail
- Status updates
- Result submission

**Definition of Done**
- Contractor can work assigned jobs without broader property access
- UI respects external-user restrictions
- Tests cover main contractor flow

**Dependencies**
- `DH-29`

**Out of Scope**
- Portfolio contractor analytics

---

### DH-31 Packages Domain

**Summary**
Add package intake and handoff workflow.

**Scope**
- Package intake
- Resident notification
- Pickup confirmation
- Package history

**Definition of Done**
- Packages can be registered, stored, and marked as issued
- Residents can be notified
- Audit/history exists for handoff

**Dependencies**
- `DH-04`
- `DH-25`

**Out of Scope**
- Locker integrations

---

## Communication And Content

### DH-32 Announcements And Documents Backend

**Summary**
Implement property communication content layer.

**Scope**
- Announcements
- Documents
- Urgent banner support
- Property/company scoping

**Definition of Done**
- Content entities and APIs are available
- Visibility rules are enforced
- Tests cover publish/list/archive flows

**Dependencies**
- `DH-01`
- `DH-03`

**Out of Scope**
- Rich CMS features

---

### DH-33 Resident Communications UI

**Summary**
Implement resident-facing announcements/documents screens.

**Scope**
- Announcement feed
- Documents list/view
- Urgent banner presentation

**Definition of Done**
- Residents can view relevant communications clearly
- UI honors scope and visibility rules
- Tests cover feed and document access

**Dependencies**
- `DH-32`

**Out of Scope**
- Advanced personalization

---

### DH-34 Notification Orchestration

**Summary**
Deliver push/SMS/Telegram notification pipeline for product events.

**Scope**
- Notification templates baseline
- Channel routing
- Delivery tracking
- Event-to-notification orchestration

**Definition of Done**
- Core events can trigger notifications through configured channels
- Delivery attempts and failures are logged
- Tests cover routing and fallback behavior

**Dependencies**
- `DH-21`
- `DH-22`
- `DH-31`
- `DH-32`

**Out of Scope**
- Marketing automation

---

## Management And Portfolio

### DH-35 Property Admin Operational Dashboard

**Summary**
Implement object-level operations dashboard for admins.

**Scope**
- Request KPIs
- Access KPIs
- Incident summary
- Notification health snapshot

**Definition of Done**
- Property admin sees actionable operational metrics
- Dashboard metrics match metric definitions spec
- Tests cover data aggregation correctness

**Dependencies**
- `DH-16`
- `DH-24`
- `DH-34`

**Out of Scope**
- Cross-property portfolio view

---

### DH-36 Management Company Portfolio API

**Summary**
Add company-level aggregated views across properties.

**Scope**
- Portfolio KPI endpoints
- Cross-property backlog/incidents summary
- Scoped company-level filters

**Definition of Done**
- Company-level users can fetch aggregated data for their properties only
- Aggregations respect tenant and company boundaries
- Tests cover scope isolation

**Dependencies**
- `DH-35`

**Out of Scope**
- Portfolio UI

---

### DH-37 Management Company Portfolio UI

**Summary**
Implement portfolio view for management company admins.

**Scope**
- Multi-property overview
- KPI comparisons
- Problem-object shortcuts
- Cross-property filters

**Definition of Done**
- Company admins can compare properties and identify problem areas
- UI matches company scope rules
- Tests cover major portfolio flows

**Dependencies**
- `DH-36`

**Out of Scope**
- Executive PDF reporting

---

### DH-38 Platform Admin Registry And Property Lifecycle

**Summary**
Implement platform admin control plane for client/property management.

**Scope**
- Property registry UI/API
- Create/enable/disable property
- Feature flag visibility
- Platform-level health summary

**Definition of Done**
- Platform admin can manage property lifecycle centrally
- Disable/enable flow is auditable and safe
- Tests cover property lifecycle actions

**Dependencies**
- `DH-01`
- `DH-39`

**Out of Scope**
- Billing and invoicing

---

### DH-39 Packaging And Feature Gating Enforcement

**Summary**
Enforce module packaging and feature-flag strategy.

**Scope**
- Feature flag persistence and resolution
- Property/company/module gates
- Backend and frontend guardrails

**Definition of Done**
- Disabled features are inaccessible in API and UI
- Packaging model matches the packaging spec
- Tests cover feature gating across roles

**Dependencies**
- `DH-01`

**Out of Scope**
- Commercial billing logic

---

## Integrations

### DH-40 Webhooks And Outbound Integration Baseline

**Summary**
Implement outbound integration/event delivery baseline.

**Scope**
- Webhook registration and delivery
- Retry and failure visibility
- Event payload versioning baseline

**Definition of Done**
- Supported events can be delivered externally
- Retries and failures are traceable
- Tests cover idempotency and retry rules

**Dependencies**
- `DH-16`
- `DH-24`
- `DH-34`

**Out of Scope**
- Vendor-specific adapters

---

### DH-41 SKUD Adapter Framework

**Summary**
Create integration framework for access-control vendor adapters.

**Scope**
- Adapter abstraction
- Provider config model
- Sync/event ingestion baseline
- Integration health/logging

**Definition of Done**
- Adapter framework can host multiple SKUD providers
- Inbound/outbound integration logs are persisted
- Tests cover adapter contract behavior

**Dependencies**
- `DH-14`
- `DH-40`

**Out of Scope**
- Specific vendor implementation

---

### DH-42 SKUD Vendor Integration Wave 1

**Summary**
Implement first production-priority SKUD vendor integrations.

**Scope**
- First-wave vendor adapters per vendor priority spec
- Pass/access sync baseline
- Inbound access event ingestion

**Definition of Done**
- At least one first-wave vendor can be configured and exercised end-to-end
- Access sync and event ingestion are observable and testable
- Integration docs are updated

**Dependencies**
- `DH-41`

**Out of Scope**
- All vendor-specific edge cases

---

### DH-43 Video Evidence Integration

**Summary**
Link access and incident events to video evidence context.

**Scope**
- Camera mapping baseline
- Clip/snapshot references
- Incident-to-video linkage

**Definition of Done**
- Access incidents can store and retrieve linked video evidence references
- Video linkage follows spec boundaries without turning DomHub into a VMS
- Tests cover linkage integrity

**Dependencies**
- `DH-08`
- `DH-16`
- `DH-41`

**Out of Scope**
- Native video playback platform

---

### DH-44 ERP / 1C / ЖКХ Exchange Baseline

**Summary**
Implement first practical ERP/1C exchange layer.

**Scope**
- Import/export baseline for residents, units, staff, and key operational records
- Source-of-truth boundaries
- Sync status and failure visibility

**Definition of Done**
- Core exchange flows work according to the ERP/1C integration spec
- Sync failures are visible and retryable
- Tests cover mapping and conflict handling baseline

**Dependencies**
- `DH-20`
- `DH-40`

**Out of Scope**
- Full accounting logic
- Deep custom ERP adaptations

---

## Analytics, Onboarding, And Delivery

### DH-45 Analytics Aggregation Jobs

**Summary**
Implement metric aggregation and reporting data flow.

**Scope**
- KPI aggregation jobs
- Metric materialization strategy
- CSV/export-ready datasets

**Definition of Done**
- Metrics from the analytics spec are computable consistently
- Aggregated values back property/company dashboards
- Tests cover metric formulas for key KPIs

**Dependencies**
- `DH-35`
- `DH-36`

**Out of Scope**
- Advanced BI tooling

---

### DH-46 Onboarding Center And Import Wizard

**Summary**
Implement reusable onboarding flow for new properties.

**Scope**
- Create-property setup wizard
- Bulk import for units/residents/staff/vehicles
- Setup checklist and validation

**Definition of Done**
- New property can be onboarded without code changes
- Import validation catches malformed data early
- Checklist makes pilot launch repeatable

**Dependencies**
- `DH-20`
- `DH-38`

**Out of Scope**
- White-label theming studio

---

### DH-47 Deployment And Tenant Ops Automation

**Summary**
Automate tenant provisioning, migration flow, and rollback-safe ops.

**Scope**
- Tenant provisioning automation
- Migration orchestration
- Backup/restore-safe runbooks or scripts
- Environment/config validation

**Definition of Done**
- Tenant lifecycle is operationally repeatable
- Migration and rollback behavior is documented and exercised
- Checks exist for invalid tenant/config states

**Dependencies**
- `DH-38`
- `DH-46`

**Out of Scope**
- Multi-region disaster recovery

---

### DH-48 Regression E2E And Release Gates

**Summary**
Implement release-blocking test gates for core platform flows.

**Scope**
- E2E coverage for resident, security, staff, admin, company flows
- Smoke/regression grouping
- CI gating rules aligned with test strategy

**Definition of Done**
- Release-blocking flows are automated
- CI reflects gate failures clearly
- Covered flows map to documented release gates

**Dependencies**
- `DH-18`
- `DH-26`
- `DH-37`
- `DH-46`

**Out of Scope**
- Cross-browser matrix explosion

---

### DH-49 Pilot Rollout Tooling And Runbooks

**Summary**
Deliver pilot-ready operational tooling and support playbooks.

**Scope**
- Pilot support views
- Incident/runbook docs alignment
- Operational checklists for first live property

**Definition of Done**
- First pilot can be launched with repeatable runbooks
- Support team has bounded troubleshooting surfaces
- Docs and tooling align with real rollout steps

**Dependencies**
- `DH-46`
- `DH-47`
- `DH-48`

**Out of Scope**
- 24/7 enterprise support organization

---

## Expansion Modules (After Core PMF)

### DH-50 Meter Readings Module

**Summary**
Implement meter reading submission and management.

**Scope**
- Meter entities
- Submission workflow
- Resident input UI
- Admin review baseline

**Definition of Done**
- Meter readings can be submitted and reviewed per property
- Validation and audit exist for submissions

**Dependencies**
- `DH-21`
- `DH-46`

**Out of Scope**
- OCR

---

### DH-51 Billing Records Baseline

**Summary**
Add billing record visibility and basic finance-linked data model.

**Scope**
- Billing record entities
- Resident-facing billing history baseline
- Admin visibility baseline

**Definition of Done**
- Billing records can be stored and displayed safely
- Visibility rules match property and resident scope

**Dependencies**
- `DH-44`

**Out of Scope**
- Online payments
- Full accounting

---

### DH-52 Space Booking Module

**Summary**
Implement reservation workflows for shared spaces.

**Scope**
- Space entities
- Availability rules
- Reservation flow
- Booking conflict handling

**Definition of Done**
- Shared spaces can be listed and booked
- Conflict and cancellation rules are enforced
- Tests cover booking edge cases

**Dependencies**
- `DH-21`
- `DH-39`

**Out of Scope**
- Revenue optimization

---

### DH-53 OCR And Smart Capture

**Summary**
Add OCR-assisted document or meter reading capture where applicable.

**Scope**
- OCR pipeline abstraction
- Input review flow
- Manual correction support

**Definition of Done**
- OCR-assisted flows are optional and reviewable
- Incorrect OCR results can be corrected safely

**Dependencies**
- `DH-50`

**Out of Scope**
- Fully autonomous decisioning

---

### DH-54 White-Label And Branding Expansion

**Summary**
Expand branding controls for customer-facing deployments.

**Scope**
- Theme/branding settings
- Asset management baseline
- Property/company-specific branding presentation

**Definition of Done**
- Supported branding surfaces can vary by tenant/package
- Branding changes do not break product consistency

**Dependencies**
- `DH-39`

**Out of Scope**
- Full design studio

---

## Recommended Delivery Order

1. `DH-21` to `DH-34`
2. `DH-35` to `DH-40`
3. `DH-41` to `DH-49`
4. `DH-50` to `DH-54`

## Release Gate Mapping

- `Operations-Ready v2`
  - `DH-21` to `DH-34`
- `Portfolio-Ready v2+`
  - `DH-35` to `DH-40`
- `Pilot-To-Production Hardening`
  - `DH-41` to `DH-49`
- `Expansion Layer`
  - `DH-50` to `DH-54`

## Notes For Ticket Authors

- If a ticket affects access flows, link the access backlog ticket it depends on.
- If a ticket changes KPIs, update `domhub-analytics-metric-definitions.md`.
- If a ticket changes package availability, update `domhub-packaging-and-feature-gating-spec.md`.
- If a ticket changes integrations, update `domhub-integration-architecture-spec.md`.
- If a ticket changes rollout/provisioning behavior, update `domhub-deployment-and-tenant-ops-spec.md`.
