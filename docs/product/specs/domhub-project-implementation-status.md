# DomHub Project Implementation Status

Date: 2026-05-11
Status: audit snapshot

This file records what is visible in the current `rezidence4` working tree against the `DH-01` through `DH-62` project backlog. It is not a roadmap and does not override `domhub-final-product-plan.md`, `domhub-master-jira-backlog.md`, or the supporting specs.

Important limitation: the working tree contains many uncommitted and untracked changes. This status means "present in the current local codebase", not "merged, deployed, and production-validated".

## Legend

- `Implemented baseline` - code exists for the main operational path, but normal hardening and release validation may still be required.
- `Partial` - some foundation exists, but the ticket's Definition of Done is not fully met.
- `Docs/planned` - documented in specs/backlog, but not implemented as product/runtime behavior.
- `Legacy/prototype` - older or experimental implementation exists, but it is not aligned enough with the current platform-v1 target.

## Executive Summary

DomHub is no longer just documentation. The codebase already contains a meaningful platform-v1 core:

- platform tenant registry, property lifecycle, tenant resolution, platform admin APIs;
- property structure, role/scope membership primitives, and profile entities for residents, staff, contractors;
- vehicle model, access topology, access requests, passes, QR/plate verification, visit logs, incidents and overrides;
- v1 frontend routes for resident access, guard console, onboarding, announcements, documents and packages;
- notifications outbox/log infrastructure, documents, announcements and packages v2;
- partial management-company, platform-admin, analytics, feature-gating and integration surfaces.

The largest gaps are still structural:

- durable `access_policies` runtime tables/routes now exist as a backend baseline;
- guard verification now accepts and stores optional `access_point_id` and `direction`; guard UI can select active access points, choose entry/exit, and record manual admit/deny decisions;
- access decisions are now backed by a deterministic policy engine baseline; manual КПП decisions now have a backend baseline, while full admin UI and offline policy/cache replay are still missing;
- service-request v1, assignment, SLA and staff workspace are mostly legacy/partial;
- Russia-readiness tickets `DH-55` through `DH-61` are mixed: resident offboarding reports, ownership-transfer/preference cascade, privacy compliance readiness, emergency dispatch readiness, GIS/OSS readiness exports, hardware manual-control boundaries, sensitive review and pilot operations training now have evidence baselines; external certification, production 24/7 emergency validation and broader field validation remain.
- full legacy runtime removal is now explicit as `DH-62`, but it is intentionally post-cutover work.

## Status By Delivery Block

| Block | Tickets | Status | Notes |
|---|---:|---|---|
| Core Access Foundation | `DH-01` to `DH-09` | Improved backend baseline | Strong base exists, including DH-06 topology, persisted role/scope membership provisioning/lookup, sensitive review workflow and broader DH-09 row-property guards. Remaining scope audit is now mostly long-tail content/platform surfaces. |
| Operational Access Backend | `DH-10` to `DH-16` | Implemented backend baseline, with release gaps | Requests, passes, vehicles, verification, incidents, policy CRUD/engine, security workspace, manual point-scoped actions, offline replay ledger and sensitive review attestations exist; broader release E2E remains. |
| Pilot-Capable Access Product | `DH-17` to `DH-20` | Improved, access slice hardened | Resident/guard/onboarding UI exists; resident vehicle self-service and vehicle-access requests are wired; checkpoint selector, entry/exit control, manual decision UI, guard offline queue/replay, property access admin baseline, planned-checkpoint conversion baseline and DH-20 production smoke E2E exist. Full release-gate validation remains. |
| Operations-Ready v2 | `DH-21` to `DH-34` | Mixed | Content, packages and notifications are advanced; service requests, SLA, staff/technician/contractor workflows are incomplete. |
| Portfolio-Ready v2+ | `DH-35` to `DH-40` | Partial | Platform admin, feature flags, management-company primitives, portfolio API and portfolio UI baseline exist; integrations need hardening. |
| Pilot-To-Production Hardening | `DH-41` to `DH-49` | Partial | SKUD provider config, hardware mapping, integration event foundations, first Hikvision + Bolid/Orion-compatible event/sync paths, video evidence reference baseline and ERP/1C exchange baseline now exist; deeper vendor rollout, E2E gates and ops tooling remain. |
| Russia Production Readiness | `DH-55` to `DH-61` | Partial, evidence surfaces added | Consent/delete baseline plus resident lifecycle/offboarding cascades, ownership-transfer/preference cascade, DSAR workflow/readiness evidence, DH-61 training pack, report UI, emergency dispatch profiles/queue/actions/readiness UI, GIS/OSS readiness exports, hardware manual-control boundaries, consent history and sensitive-action review assignment/SLA/sampling/escalation/analytics exist; external certification, production 24/7 validation and broader field validation remain. |
| Expansion Layer | `DH-50` to `DH-54` | Legacy/prototype | Some legacy meters/billing/bookings/branding surfaces exist and are feature-gated; not current priority. |
| Legacy Cutover | `DH-62` | Docs/planned | Deprecated `/api/*` aliases, legacy UI/runtime paths and fallback flags still exist; removal must follow proven v1 cutover and replacement modules. |

## Ticket-Level Status

| Ticket | Title | Status | Evidence / gap |
|---|---|---|---|
| `DH-01` | Tenant Foundation | Implemented baseline | `platformMigrations.js`, platform property/admin routes, and `propertyDbMiddleware` exist. Needs final release validation for isolation. |
| `DH-02` | Property Structure | Implemented baseline | v1 `buildings`, `entrances`, `units` migrations/routes exist; cottage labels/import support exists. |
| `DH-03` | Memberships And Roles | Improved backend baseline | `role_scope_memberships` now supports external platform/company subject mirrors, provisioning metadata, `/api/v1/memberships`, persisted lookup helper and automatic resident/staff/contractor provisioning/suspension. Remaining work: platform registry sync jobs and UI management depth. |
| `DH-04` | Profiles Domain | Implemented baseline | `residents`, `staff_users`, `contractor_companies`, `contractor_users` migrations/routes exist. |
| `DH-05` | Vehicle Model | Implemented baseline | `vehicles` migration/routes/service, normalization, whitelist/blacklist and ownership checks exist. |
| `DH-06` | Access Zones And Points | Implemented backend baseline | `access_zones` / `access_points` migration, FK-ready constraints, CRUD routes, validation helper, import provisioning and guard verify wiring exist. |
| `DH-07` | Access Request And Pass Schema | Implemented baseline | `access_requests`, `access_approvals`, `passes`, `qr_passes_v2`, `visit_logs_v2` migrations exist and now carry optional topology references through runtime flows. |
| `DH-08` | Access Incident And Audit Schema | Improved backend review workflow | `access_incidents`, `access_overrides`, `property_audit_log`, audit event catalog, sensitive-action review listing, assignment/SLA queue metadata, sampling/escalation operations, anti-abuse analytics and `/api/v1/audit/sensitive-actions/:id/review` attestation now exist. Remaining DH-60 depth is UI/report evidence and richer anomaly rules. |
| `DH-09` | Permission Middleware | Improved backend guard baseline | Shared capability middleware, persisted membership lookup helper, expanded `resourceScope` ownership lookups and route guards now cover structure/residents/staff/contractors/vehicles/access-requests/passes/access-incidents/overrides. Remaining work: content/admin long-tail and replacing all derived fallbacks post-cutover. |
| `DH-10` | Access Request Service | Implemented baseline | `accessRequestService.js`, lifecycle routes and transition guards exist; optional topology target validation and pass inheritance are wired. |
| `DH-11` | Pass Issuance And QR Flow | Implemented baseline | `passService.js`, pass routes, QR fetch/regenerate/revoke/block flows exist; direct passes can carry validated `zone_id` / `point_id`. |
| `DH-12` | Vehicle Access Service | Improved backend baseline | Plate verification persists `access_point_id`, supports entry/exit direction and now evaluates owner/vehicle metadata policies for registered non-whitelisted vehicles while preserving blacklist/unknown-plate hard denies. Remaining work: broader vendor/hardware reconciliation E2E. |
| `DH-13` | Policy And Approval CRUD | Implemented backend baseline | `028_access_policies`, `accessPolicyService.js`, `/api/v1/access-policies`, default policy templates and route tests exist. |
| `DH-14` | Policy Evaluation Engine | Implemented backend baseline | Deterministic priority/schedule/scope evaluation is wired into `verifyPass` after hard checks; verify API and audit include `policy_decision`. |
| `DH-15` | Security Workspace API | Implemented backend baseline | `/api/v1/security-workspace/bootstrap`, `/search`, `/recent-events` exist; verify supports `direction=entry|exit`; manual/degraded decision action is covered by `DH-16`. |
| `DH-16` | Manual Override And Incident Flow | Implemented backend baseline | `/api/v1/security-workspace/manual-decision` records manual admit/deny as visit log + resolved manual_override incident + override + sensitive audit; `/offline-replay` adds idempotent degraded-mode replay ingestion and links replay ids back to visit logs. |
| `DH-17` | Resident Access UI | Improved, access baseline complete | `ResidentAccessPage` supports guest/courier/service requests plus resident vehicle registration/listing and `vehicle_access` request creation; QR display and E2E smoke cover key resident flows. Remaining work is UX depth, not a blocking access-slice gap. |
| `DH-18` | Security Workspace UI | Improved, offline baseline added | `GuardConsolePage` and `ScanPanel` exist with vehicle-first cottage behavior, active access-point selector, entry/exit control, manual admit/deny form with degraded metadata and local offline queue/replay. Broader server recent-event panels remain hardening. |
| `DH-19` | Property Admin UI | Improved, baseline added | `/v1/admin/access` now covers access zones/points, policy creation/deactivation, vehicle flag lookup, and incident review; richer edit flows and analytics are still missing. |
| `DH-20` | Onboarding, Import, And Smoke E2E | Improved, smoke E2E added | CSV import supports cottage homes/vehicles and provisions planned checkpoints into real `access_zones` / `access_points`; `e2e/v1-access-production.spec.js` now covers resident guest QR, resident vehicle registration + `vehicle_access`, cottage onboarding import, checkpoint selector, vehicle verify with `access_point_id` + `direction` + `policy_decision`, and manual admit. Full release-gate validation still depends on live E2E DB/infra. |
| `DH-21` | Resident Auth And Session Hardening | Improved, still partial | Auth, `/me`, refresh, consent and delete-account use tenant DB context; offboarding revokes sessions; resident consent now writes consent history and lifecycle events. Remaining work: full offboarding cascades and final v1 subject split. |
| `DH-22` | Request Categories And Request Core | Improved, backend baseline added | `/api/v1/requests` now has category catalog/config endpoints, territory/emergency built-in categories, tenant-aware request service calls, v1 target/priority/SLA fields and migration `v1_029_service_request_core`; local DB migration applied successfully. Full dedicated `service_requests` split, assignment and UI remain deferred. |
| `DH-23` | Request Attachments And Resident Updates | Improved, backend baseline added | `request_attachments`, `request_updates`, `/requests/:id/attachments`, `/requests/:id/updates`, local upload ownership validation and resident-visible filtering now exist. Internal-only staff notes UI/API remain deferred. |
| `DH-24` | Assignment, SLA, And Escalation Engine | Improved, backend baseline added | `v1_031_request_assignment_sla`, request assignee/SLA columns, `request_sla_events`, `/requests/:id/assign`, `/requests/:id/first-response`, lifecycle timestamp updates and deterministic SLA event escalation now exist. Company-level SLA UI remains deferred. |
| `DH-25` | Staff Workspace API | Improved, backend baseline added | `/api/v1/staff-workspace` now exposes inbox, overdue queue, request detail aggregation, internal comments and resident quick view. Phone visibility and resident denial are covered by tests. |
| `DH-26` | Staff Workspace UI | Improved, frontend baseline added | `/v1/staff-workspace` now provides a unified staff inbox, queue/status/priority/search filters, request detail workspace, internal notes, resident quick view, SLA timeline and quick actions for assignment, first response and status transitions. |
| `DH-27` | Technician Workflow Backend | Improved, backend baseline added | `/api/v1/technician-workspace` now exposes technician queue/detail plus claim, start/resume, waiting and resolve actions. `v1_032_technician_workflow` adds execution output fields and technician KPI events. |
| `DH-28` | Technician Workflow UI | Improved, frontend baseline added | `/v1/technician-workspace` now provides technician queue filters, task detail, claim/start/resume/waiting/resolve actions, resolution notes, follow-up flag, attachment ids and technician event timelines. |
| `DH-29` | Contractor Workflow Backend | Improved, backend baseline added | `/api/v1/contractor-workspace` now exposes contractor queue/detail plus concierge/admin assignment and contractor start/resume/waiting/resolve actions. `v1_033_contractor_workflow` adds contractor assignment bindings and contractor KPI events with active/expiry/company checks. |
| `DH-30` | Contractor Portal UI | Improved, frontend baseline added | `/v1/contractor-workspace` now provides a restricted contractor queue/detail portal with start/resume, waiting-for-parts and result submission actions over `/api/v1/contractor-workspace`. |
| `DH-31` | Packages Domain | Rechecked, guard/SLA hardening added | `packages_v2`, resident/admin package pages, role-aligned package guards and SLA 7/14/30 outbox reminders/follow-ups/admin-alerts exist; auto-return is intentionally absent. |
| `DH-32` | Announcements And Documents Backend | Rechecked, guard/public routing hardening added | `announcements_v2`, `documents_v2`, versions, public/admin routes and services exist; communications route guards now exclude technician, keep security read-only, limit writes/admin consoles to concierge/admin, and public content slug routes resolve tenant context through middleware. |
| `DH-33` | Resident Communications UI | Rechecked, resident UI hardening added | Resident announcements/documents pages exist; announcements now surface urgent items in a dedicated resident banner and documents exercise both list and row visibility through a resident detail panel. |
| `DH-34` | Notification Orchestration | Rechecked, delivery correlation hardening added | Outbox, log, worker, templates, push/SMS/Telegram/webhook adapters, retry/DLQ and admin health/retry surfaces exist; worker now passes `correlation_id` into channel adapters so webhook delivery headers preserve event correlation. Email remains a deferred stub. |
| `DH-35` | Property Admin Operational Dashboard | Improved, operational snapshot added | `/api/v1/admin/operations-dashboard` and `/v1/admin/operations` now provide property-scoped request KPIs, access KPIs, incident summary and notification health for admins. Review-workflow depth remains under sensitive-action/audit follow-up scope. |
| `DH-36` | Management Company Portfolio API | Improved, backend baseline added | `/api/v1/management-company/portfolio` now aggregates DH-35 property snapshots across only the current management company's properties, with period/property filters, weighted rollups, hotspot rankings and scope-isolation tests. |
| `DH-37` | Management Company Portfolio UI | Improved, frontend baseline added | `/v1/portfolio` now gives management-company admins a multi-property overview with KPI rollups, problem-object rankings, cross-property filters and comparison rows over the DH-36 API. |
| `DH-38` | Platform Admin Registry And Property Lifecycle | Rechecked, lifecycle hardening added | Platform property status changes now use audited `/platform/api/v1/properties/:slug/lifecycle` actions with required operator reason, direct `status` PATCH is blocked, create/transition flows mirror `is_active`, and the platform detail UI uses the lifecycle action for status/toggle changes. |
| `DH-39` | Packaging And Feature Gating Enforcement | Rechecked, package-aware gates added | Feature flags now resolve through canonical package ids (`core_access`, `operations`, `portfolio`, `enterprise`), legacy plan ids are normalized by migration, platform property create/update validates package ids, and admin flag writes cannot enable modules outside the property's package. |
| `DH-40` | Webhooks And Outbound Integration Baseline | Rechecked, outbound envelope baseline added | Legacy webhooks/integrations and outbox foundations exist; outbound webhook deliveries now carry versioned `v1` envelopes, stable delivery/outbox ids for idempotent receiver dedupe, correlation headers and retry attempt headers across both v1 outbox and legacy delivery paths. Full canonical integration layer remains future DH-41+ work. |
| `DH-41` | SKUD Adapter Framework | Improved, backend framework baseline added | `v1_034_skud_adapter_framework` adds tenant-scoped provider configs, hardware device mappings with source-of-truth/fallback rules, and idempotent integration event logs; `skudIntegrationService` and the adapter registry can host multiple providers without leaking vendor models into access-domain code. |
| `DH-42` | SKUD Vendor Integration Wave 1 | Improved, common Russia provider baseline added | `/api/v1/skud/providers/:id/events` ingests provider events into `skud_integration_events` and `visit_logs_v2`, `/sync-pass` exercises outbound pass provision/revoke through the adapter registry, `HikvisionAdapter` normalizes common access events, `BolidAdapter` covers Orion Pro JSON-RPC visit provisioning/revocation, and configurable REST/template adapters now cover Sigur, Parsec, PERCo, RusGuard, IronLogic, TRASSIR Access and generic integrations. Full vendor-specific edge cases, reconciliation and field rollout remain future work. |
| `DH-43` | Video Evidence Integration | Improved, VMS/NVR provider baseline added | `video_evidence_references`, `/api/v1/access-incidents/:id/video-evidence`, `/api/v1/video-evidence/:id`, camera listing over mapped `skud_hardware_devices`, sensitive link/view audit events and no-biometrics validation now exist. `video_provider_configs`, camera-to-VMS mapping and link-only fetch references now cover TRASSIR, Macroscop, Hikvision NVR, Dahua NVR, Axxon Next, DevLine Line and generic link templates. Native VMS playback remains out of scope/future work. |
| `DH-44` | ERP / 1C / ЖКХ Exchange Baseline | Improved, backend baseline added | `v1_038_erp_exchange_baseline` adds tenant-scoped ERP provider configs, explicit external-ID mappings, sync jobs and row validation records; `/api/v1/erp` supports provider config, import preview/apply and JSON exports for access events, incidents and requests behind `erp_exchange`. Apply mode writes mappings only and creates no access grants or billing authority. |
| `DH-45` | Analytics Aggregation Jobs | Improved, backend baseline added | `analytics_kpi_snapshots` now materializes DH-35 KPI formulas into stable per-property snapshots and CSV-ready flat rows for `24h`, `7d` and `30d`; `/api/v1/analytics/snapshots*` exposes admin read/manual materialization behind `analytics`, and `ANALYTICS_AGGREGATION_ENABLED` starts a package-aware multi-tenant runner. Canonical event-sourced rollups and advanced BI remain future work. |
| `DH-46` | Onboarding Center And Import Wizard | Improved, import baseline expanded | v1 onboarding/import now covers structure, residents, vehicles, planned checkpoints, staff, contractor companies and contractor users with template/preview/apply endpoints and checklist summaries. Property creation wizard UI and lifecycle import remain incomplete. |
| `DH-47` | Deployment And Tenant Ops Automation | Improved, restore gate added | Migrations, Docker and runbooks exist; `tenant-ops-preflight.cjs` now validates global/platform/tenant DB config, reachability and platform/property migration state before backend-backed E2E seed/webServer startup. `tenant-ops-provision.cjs` and `tenant-ops-migrate.cjs` add repeatable new-tenant provisioning, optional DB creation, full property migration application, initial admin seeding and controlled active-tenant migration batches. `restore-drill-preflight.cjs` adds backup freshness/gzip/Docker preflight, npm restore-drill commands and nightly synthetic CI coverage. Full staging restore against real backups remains required evidence. |
| `DH-48` | Regression E2E And Release Gates | Improved, executable matrix added | Unit/smoke/e2e files and coverage gates exist; `release-gate-matrix.cjs` now maps gate phases to required root scripts and evidence files, `npm run release:gate:check` validates the matrix, and `verify:strict` runs the matrix check before release-blocking E2E. Full CI/staging evidence still needs a clean strict run. |
| `DH-49` | Pilot Rollout Tooling And Runbooks | Improved, readiness gate added | Runbook index and support docs exist; `docs/runbooks/pilot-rollout.md` now covers property launch, tenant provisioning, resident activation, checkpoint training, degraded mode, emergency dispatch, first-week support, incident escalation, data correction/offboarding, backup/restore and go/no-go. `pilot-readiness-check.cjs` and `npm run pilot:readiness` make the pilot evidence set executable and are wired into the release gate matrix. Degraded-mode product offline replay remains separate Russia-readiness work. |
| `DH-50` | Meter Readings Module | Legacy/prototype | Legacy meter routes are present and feature-gated; not a final expansion module. |
| `DH-51` | Billing Records Baseline | Legacy/prototype | Legacy billing routes are present and feature-gated; not final v2 billing. |
| `DH-52` | Space Booking Module | Legacy/prototype | Legacy spaces/bookings are present and feature-gated; not final expansion work. |
| `DH-53` | OCR And Smart Capture | Docs/planned | No OCR product implementation found. |
| `DH-54` | White-Label And Branding Expansion | Partial | Some styling/runtime surfaces exist; full customer branding module is not complete. |
| `DH-55` | Resident Lifecycle And Ownership Changes | Improved, ownership transfer baseline added | Resident create/update/consent writes lifecycle events and membership provisioning; `v1_042_resident_offboarding_cascade` adds `resident_unit_links`, vehicle offboarding review markers, and `/api/v1/residents/:id/deactivate` now deactivates resident scope, unit links, active resident/vehicle passes, pending access requests, notification preferences and vehicle whitelist access with lifecycle/audit summary. `v1_047_readiness_live_evidence_and_transfers` adds `resident_ownership_transfers`, `resident_notification_preferences` and `/api/v1/residents/:id/transfer-ownership` to offboard the previous owner, activate the new owner link and cascade preferences. `/api/v1/residents/offboarding-report` and `/v1/admin/offboarding` expose admin evidence over recent deactivations and vehicle review queue. |
| `DH-56` | RU Personal Data Compliance Controls | Improved, DSAR/readiness baseline added | Consent and account deletion/anonymization baseline exists; consent history plus DSAR export/delete/correct/restrict workflow, retention/localization/ИСПДн/no-biometrics evidence ledger and `/api/v1/privacy/readiness` now exist. Formal legal certification, production retention automation and real pilot evidence remain incomplete. |
| `DH-57` | Emergency Dispatch Mode | Improved, live provider evidence baseline added | Emergency categories now create `emergency_request_profiles` via `v1_043_emergency_dispatch_mode`, with severity, escalation target, dispatch status, SLA due timestamps, `/api/v1/requests/emergency/queue`, `/api/v1/requests/:id/emergency-dispatch` actions and distinct `request.emergency_created` notification routing. `v1_046_emergency_readiness_evidence`, `v1_047_readiness_live_evidence_and_transfers`, `/api/v1/requests/emergency/readiness`, `/api/v1/requests/emergency/drills`, `/api/v1/requests/emergency/provider-delivery-evidence` and `/v1/admin/emergency-dispatch` add active queue KPIs, on-call roster evidence, provider notification evidence, operational drill records and live provider delivery observations. Remaining work: external certification and production 24/7 validation. |
| `DH-58` | GIS ЖКХ And OSS Readiness | Improved baseline | `v1_045_gis_oss_readiness_exports` adds `gis_oss_export_packages` with document/announcement/protocol/operational references, explicit non-authoritative/non-certified flags constrained to false, `/api/v1/gis-oss` boundary/list/create/detail APIs behind the `gis_oss_readiness` feature flag, and `/v1/admin/gis-oss` for admin package generation/listing. Package generation audits `gis_oss.export_package.generated` as a restricted export. Remaining work: generated file packaging format, ops evidence and future certified integration path. |
| `DH-59` | Hardware Device Registry And Manual-Control Boundaries | Improved backend baseline | `v1_044_hardware_manual_control_boundaries` extends `skud_hardware_devices` with manual-control policy, reason/approval flags, fail-safe mode, maintenance state and last manual-action markers; `hardware_manual_control_events` records append-only manual actions. `/api/v1/skud/hardware-devices*` now exposes scoped device listing, admin boundary updates, guard/admin manual-control events and event evidence. Remaining work: real vendor command execution, provider failure dashboards and field rollout evidence. |
| `DH-60` | Sensitive Action Audit And Anti-Abuse Reviews | Improved backend baseline | Sensitive-action review listing, queue summary, reviewer assignment, due date/priority metadata, attestation persistence, sampled review materialization, overdue/escalation maintenance runner and actor/category anti-abuse analytics exist over immutable audit rows. Remaining work: UI/report evidence, notification fanout for escalations and richer anomaly rules. |
| `DH-61` | Pilot Operations And Training Pack | Improved, training evidence pack added | `docs/runbooks/pilot-operations-training-pack.md`, `platform-v1/pilot-operations-training-pack-spec.md` and `npm run pilot:training-pack` now package first-week support, guard/checkpoint training, emergency drill, resident offboarding drill, PDn/DSAR support, evidence capture and sign-off expectations. Real retained pilot evidence remains external. |
| `DH-62` | Legacy Runtime Removal | Docs/planned | Deprecated `/api/*` aliases and legacy utility/runtime paths are still mounted. Removal is planned only after release gates prove supported flows use v1/platform contracts and legacy meters/billing/bookings replacements are live. |

## Sequential Verification Progress

Started after `DH-03` implementation pass on 2026-05-05.

| Ticket | Verification result | Evidence checked | Next action |
|---|---|---|---|
| `DH-01` | Confirmed implemented baseline | `propertyDbMiddleware`, platform property/admin routes, platform DB/property tests. | Keep release validation for isolation/cross-tenant regression. |
| `DH-02` | Confirmed implemented baseline | `001_buildings`, `002_entrances`, `003_units`, `structure.js`, cottage import/template support. | No immediate blocker; dependent on `DH-06` for real checkpoints. |
| `DH-03` | Improved backend baseline | `026_role_scope_memberships`, `040_membership_review_lifecycle`, `roleScopeMembershipService.js`, `/api/v1/memberships`, persisted authz helper and automatic people provisioning/suspension now exist. | Add platform registry sync jobs and richer admin UI for membership management. |
| `DH-04` | Confirmed implemented baseline | `004_residents`, `005_staff_users`, `006_contractor_companies`, `007_contractor_users`, profile routes. | Later hardening: lifecycle/offboarding under `DH-55`. |
| `DH-05` | Confirmed implemented baseline | `008_vehicles`, `vehicles.js`, `vehicleService.js`, whitelist/blacklist/owner checks. | Later hardening: checkpoint-aware vehicle decisions under `DH-12`/`DH-15`. |
| `DH-06` | Improved to backend baseline | `027_access_topology`, `accessTopology.js`, `accessTopologyService.js`, route/service tests and updated platform-v1 spec now exist. | Use topology in policy CRUD/evaluation under DH-13/DH-14. |
| `DH-07` | Rechecked implemented baseline | `009_access_requests`, `010_access_approvals`, `011_passes`, `012_qr_passes_v2`, `013_visit_logs_v2`; topology ids now flow through access request, pass and visit-log services. | Keep schema release validation with FK constraints. |
| `DH-08` | Improved backend review workflow | `014_access_incidents`, `015_access_overrides`, `property_audit_log`, `auditEventCatalog.js`, `auditReviewService.js`, `/api/v1/audit/sensitive-actions` and review attestation tests. | Add review assignment/SLA/sampling under `DH-60`; keep access incident flow tied to `DH-16`. |
| `DH-09` | Improved backend guard baseline | `resourceScope.js`, `authz.js`, persisted membership helper and route guards now resolve row `property_id` before critical id-only reads/writes in structure/residents/staff/contractors/vehicles/access-requests/passes/access-incidents/overrides. | Continue long-tail coverage for packages, documents, announcements and management-company/platform surfaces. |
| `DH-10` | Rechecked implemented baseline | `accessRequests.js`, `accessRequestService.js`, state-machine tests and route tests; topology targets validate and pass inheritance is covered. | Later add policy-backed approval rules under DH-13/DH-14. |
| `DH-11` | Rechecked implemented baseline | `passes.js`, `passService.js`, QR/regenerate/revoke/block tests; direct pass topology scope is wired. | Keep policy binding nullable until DH-13/DH-14. |
| `DH-12` | Improved backend baseline | `verifyPass.js`, `accessPolicyService.js`, `visitService.js`, `visits.js`; QR/plate verification stores `access_point_id`, direction and owner/vehicle metadata policy decisions. | Add vendor/hardware reconciliation E2E and guard UI policy explanations. |
| `DH-13` | Implemented backend baseline | `028_access_policies`, `accessPolicies.js`, `accessPolicyService.js`, template catalog and CRUD tests now exist. | Add richer approval-rule UI later. |
| `DH-14` | Implemented backend baseline | `verifyPass` now evaluates active policies after base hard checks and records `policy_decision` trace in API/audit. | Add degraded guard policy cache and broader policy E2E. |
| `DH-15` | Implemented backend baseline | `securityWorkspace.js`, `securityWorkspaceService.js`, route tests and verify `direction=entry|exit` now exist. | Wire full UI under `DH-18`; keep offline replay as hardening. |
| `DH-16` | Implemented backend baseline | `createManualSecurityDecision`, `POST /security-workspace/manual-decision`, `security_offline_replay_events`, `visit_logs_v2.offline_replay_event_id` and `POST /security-workspace/offline-replay` cover manual degraded decisions, idempotent replay and visit-log reconciliation. | Keep provider/hardware reconciliation tests under DH-41/DH-59. |
| `DH-17` | Improved access baseline | `ResidentAccessPage`, `AccessRequestForm`, `vehicles.js`, `vehicleService.js` and `v1-access-production.spec.js` now cover resident vehicle listing/registration plus `vehicle_access` request creation. | Add richer resident pass/history filters when product needs more self-service depth. |
| `DH-18` | Improved offline baseline | `ScanPanel` loads `/access-points`, lets guard select КПП, sends `access_point_id` and `direction` to `/visits/verify`, records manual admit/deny, persists local offline manual decisions, and replays them through `/security-workspace/offline-replay`. | Add richer server recent-event panel integration. |
| `DH-19` | Improved, baseline added | `AccessAdminPage`, `accessPoliciesApi`, topology mutation helpers and `/v1/admin/access` route now exist for topology, policies, vehicle flags and incident review. | Add edit/details flows, policy dry-run UI and richer admin analytics. |
| `DH-20` | Improved, smoke E2E added | `units/import` converts `planned_access_points` into `access_topology` zones/points; onboarding UI shows provisioned КПП; `v1-access-production.spec.js` now covers resident guest QR, resident vehicle access, cottage import → policy → guard КПП selector → plate verify/manual admit. | Run full strict E2E against live local/staging DB before marking pilot-ready. |
| `DH-21` | Improved, still partial | `auth.js`, `middleware/auth.js`, `privacy.js`, `users.js`, `authSessionService.js`, consent history and resident lifecycle hooks now align sessions and consent with tenant context. | Continue with final v1 subject split and DSAR/retention depth in `DH-56`. |
| `DH-22` | Improved, backend baseline added | `service_request_categories`, request target/priority/SLA columns, `/requests/categories` endpoints, territory/emergency defaults and tests now exist. `/api/v1/requests` remains the compatibility bridge instead of a final dedicated table split. | Continue with attachments/resident updates in `DH-23`, then assignment/SLA automation in `DH-24`. |
| `DH-23` | Improved, backend baseline added | `v1_030_request_attachments_updates`, `RequestUpdatesService`, `/requests/:id/attachments`, `/requests/:id/updates`, upload ACL integration and focused tests now exist. | Continue with assignment/SLA automation in `DH-24`; later add internal staff notes UI/API and richer media gallery only if product scope requires it. |
| `DH-24` | Improved, backend baseline added | `RequestSlaService`, `v1_031_request_assignment_sla`, `/requests/:id/assign`, `/requests/:id/first-response`, request lifecycle timestamps and `request_sla_events` now exist; runtime SLA job uses idempotent events instead of only legacy history markers. | Continue with `DH-25` staff workspace API: inbox filters, overdue queues and request detail aggregation over the new assignment/SLA fields. |
| `DH-25` | Improved, backend baseline added | `staffWorkspaceService.js`, `staffWorkspace.js`, `/staff-workspace/inbox`, `/overdue`, `/requests/:id`, `/requests/:id/internal-comments` and `/residents/:id/quick-view` now exist with access and phone-visibility tests. | Use these contracts from `DH-26`; keep backend hardening for dedicated service-request v1 split. |
| `DH-26` | Improved, frontend baseline added | `StaffWorkspacePage`, `staffWorkspaceApi`, `/v1/staff-workspace` routing, router smoke coverage and page tests now cover queue loading/filtering, request detail, resident quick view, internal notes and quick actions. | Continue with `DH-27` Technician Workflow Backend. |
| `DH-27` | Improved, backend baseline added | `technicianWorkspaceService.js`, `technicianWorkspace.js`, `/technician-workspace/queue`, `/requests/:id`, `/claim`, `/start`, `/resume`, `/waiting`, `/resolve`, migration `v1_032_technician_workflow` and route/migration tests now cover technician visibility, transitions, output fields and KPI events. | Continue with `DH-28` Technician Workflow UI using the technician workspace contracts. |
| `DH-28` | Improved, frontend baseline added | `TechnicianWorkspacePage`, `technicianWorkspaceApi`, `/v1/technician-workspace` routing and page/router tests now cover queue/detail loading, filters, claim/start, waiting and resolve with result fields. | Continue with `DH-29` Contractor Workflow Backend. |
| `DH-29` | Improved, backend baseline added | `contractorWorkspaceService.js`, `contractorWorkspace.js`, `/contractor-workspace/queue`, `/requests/:id`, `/assign`, `/start`, `/resume`, `/waiting`, `/resolve`, migration `v1_033_contractor_workflow` and route/migration/authz tests now cover active/expiry profile checks, company status, limited payloads, assignment and completion events. | Continue with `DH-30` Contractor Portal UI. |
| `DH-30` | Improved, frontend baseline added | `ContractorWorkspacePage`, `contractorWorkspaceApi`, `/v1/contractor-workspace` routing, restricted detail rendering and page/router tests now cover contractor queue/detail loading, filters, start/resume, waiting, resolve and local non-contractor denial. | Recheck `DH-31` Packages Domain and confirm no remaining package gaps. |
| `DH-31` | Rechecked, guard/SLA hardening added | Package backend guards now match the role matrix (`security` intake/pickup only, `concierge` operations, admin all); `/v1/packages` admits security while hiding return/remind/lost; package SLA runner now sends 7-day resident reminders, 14-day concierge follow-ups and 30-day admin alerts without changing package status. | Continue with `DH-32` Announcements And Documents Backend recheck. |
| `DH-32` | Rechecked, guard/public routing hardening added | Announcements/documents routes now use communications-specific reader/writer guards; security remains read-only, technician is excluded from communications endpoints, write/admin flows are concierge/admin, and `/public/:slug/(documents|announcements)` can resolve tenant context before route handling. | Continue with `DH-33` Resident Communications UI recheck. |
| `DH-33` | Rechecked, resident UI hardening added | Resident announcements now include a dedicated urgent banner while preserving pinned/urgent/newest ordering; resident documents now open a detail panel backed by `GET /documents/:id` and tests cover the row endpoint path. | Continue with `DH-34` Notification Orchestration recheck. |
| `DH-34` | Rechecked, delivery correlation hardening added | Notification outbox/worker/adapters were rechecked against the DH-34 scope; the worker now forwards `correlation_id` to channel adapters so webhook deliveries keep stable event correlation in headers. Focused tests cover worker state-machine, adapter contracts, dispatcher routing, producer validation and runner lifecycle. | Continue with `DH-35` Property Admin Operational Dashboard. |
| `DH-35` | Improved, operational snapshot added | Added property-admin operations dashboard API and UI covering request throughput/SLA, access approvals/traffic, incident load and notification delivery/queue health. Admin landing now opens the operations dashboard, with focused backend aggregation tests and frontend route/smoke coverage. | Continue with `DH-36` Management Company Portfolio API. |
| `DH-36` | Improved, backend baseline added | Added management-company portfolio API over DH-35 snapshots, including current-company scope resolution, active-property default filtering, explicit property filter rejection outside the portfolio, weighted SLA/access/notification rollups, hotspot rankings and partial-tenant failure isolation. | Continue with `DH-37` Management Company Portfolio UI. |
| `DH-37` | Improved, frontend baseline added | Added the management-company portfolio workspace, API client/types, route gate, role redirect for `management_company_admin`/`platform_admin`, cross-property filters, problem-object shortcuts and smoke/router coverage. | Continue with `DH-38` Platform Admin Registry And Property Lifecycle recheck. |
| `DH-38` | Rechecked, lifecycle hardening added | Added the property lifecycle endpoint with reason-required audit details, blocked generic PATCH status changes, fixed create-time `status`/`is_active` mirroring, wired the platform property detail UI to lifecycle actions and added lifecycle validation/no-op/audit tests. | Continue with `DH-39` Packaging And Feature Gating Enforcement recheck. |
| `DH-39` | Rechecked, package-aware gates added | Added canonical package ids to the packaging spec/config, normalized legacy `standard/core/premium/pro` plans via platform migration, validated property package ids in platform API/UI, resolved feature flags through package constraints, and blocked admin toggles that would enable a module outside the package. | Continue with `DH-40` Webhooks And Outbound Integration Baseline recheck. |
| `DH-40` | Rechecked, outbound envelope baseline added | Added versioned outbound webhook payloads and headers (`v1`, delivery/event id, correlation id, retry attempt), switched v1 webhook idempotency from business `correlation_id` to stable `notifications_outbox.id`, mirrored the envelope in the legacy `webhook_deliveries` path, and documented the contract in the integration architecture spec. | Continue with `DH-41` SKUD Adapter Framework recheck. |
| `DH-41` | Improved, backend framework baseline added | Added the SKUD framework migration, provider/device/event service, adapter registry contract and focused tests for migration shape, adapter registration and provider/device/event behavior. | Continue with `DH-42` SKUD Vendor Integration Wave 1 recheck. |
| `DH-42` | Improved, common Russia provider baseline added | Added SKUD routes for inbound provider events and admin pass sync, wired event ingestion to provider/device/event service, normalized common Hikvision and Bolid/Orion payloads, added Orion Pro JSON-RPC visit provisioning/revocation/health baseline, expanded provider configs/adapters for Sigur, Parsec, PERCo, RusGuard, IronLogic and TRASSIR Access, recorded provider events in `visit_logs_v2`, and covered service/route/adapter behavior with focused tests. | Continue with `DH-43` Video Evidence Integration recheck. |
| `DH-43` | Improved, VMS/NVR provider baseline added | Added link-only video evidence storage, incident/list/view/fetch routes, camera mapping reads over SKUD hardware devices, `video_provider_configs`, first-wave VMS/NVR adapters for TRASSIR/Macroscop/Hikvision/Dahua/Axxon/DevLine/generic links, sensitive audit events and schema/service-level no-biometrics enforcement. | Continue with `DH-44` ERP / 1C / ЖКХ Exchange Baseline recheck. |
| `DH-44` | Improved, backend baseline added | Added ERP/1C/ЖКХ exchange tables, service, routes, feature flag and sensitive audit actions for provider configs, dry-run/apply imports, external-ID mappings and operational JSON exports. | Continue with `DH-45` Analytics Aggregation Jobs. |
| `DH-45` | Improved, backend baseline added | Added materialized analytics snapshot storage, admin snapshot/CSV routes, KPI flattening over DH-35 formulas, package-aware periodic runner and focused tests for formulas, route scope and per-tenant isolation. | Continue with `DH-46` Onboarding Center And Import Wizard. |
| `DH-46` | Improved, import baseline expanded | Added staff and contractor onboarding import services/routes with CSV templates, preview/apply validation, idempotent duplicate skips and checklist summaries while preserving the existing cottage `units/import` path. | Continue with `DH-47` Deployment And Tenant Ops Automation. |
| `DH-47` | Improved, restore gate added | Added `scripts/tenant-ops-preflight.cjs`, root `tenant:preflight*` commands, strict/webServer integration, migration-state reporting and tests. Local DB/Redis preflight now reaches global/platform/tenant DBs, reports the full tenant migration chain as current, seeds E2E access data after applying tenant migrations, and the release-blocking `v1-access-production.spec.js` slice passes through the Playwright retry wrapper. Added `tenant:provision`, `tenant:migrate`, `tenant:restore-drill:preflight` and cross-platform `tenant:restore-drill` for repeatable tenant creation, controlled migrations and backup-restore gating. A clean local `npm run verify:strict` run now passes, and local backup restore evidence exists for `residenze`, `platform` and `zamoskv`. | Continue with staging/prod restore evidence against real retained backups and keep backup/restore gates in release checks. |
| `DH-48` | Improved, executable matrix added | Added `scripts/release-gate-matrix.cjs`, `release:gate:matrix`, `release:gate:check`, focused tests, and strict-gate integration so release-blocking scripts/specs/docs cannot silently drift from the gate checklist. | Continue with clean CI/staging strict-gate evidence, then `DH-49` pilot rollout tooling/runbooks. |
| `DH-49` | Improved, readiness gate added | Added `docs/runbooks/pilot-rollout.md`, linked it from the operational runbook index, added `scripts/pilot-readiness-check.cjs`, `pilot:readiness`, tests, and release-gate-matrix coverage. | Continue with Russia readiness evidence/UI depth for DH-55/DH-57/DH-58/DH-59/DH-60. |
| `DH-55` | Improved, ownership transfer baseline added | Added `v1_042_resident_offboarding_cascade`, `resident_unit_links`, vehicle offboarding review markers, `residentOffboardingService`, and deactivation route cascade across memberships, household/unit links, active passes, resident-created access requests, notification preferences and resident vehicles. Added `v1_047_readiness_live_evidence_and_transfers`, `/api/v1/residents/:id/transfer-ownership`, transfer lifecycle/audit evidence and notification preference cascade. Added `/api/v1/residents/offboarding-report`, `/v1/admin/offboarding`, typed frontend client and focused tests for report evidence. | Continue with real pilot validation and admin UI depth for transfer history. |
| `DH-57` | Improved, live provider evidence baseline added | Added `v1_043_emergency_dispatch_mode`, emergency request profiles, emergency queue listing, dispatch/acknowledge/escalate/resolve actions and `request.emergency_created` notification routing for emergency service requests. Added `v1_046_emergency_readiness_evidence`, active on-call roster and drill record tables, plus `v1_047_readiness_live_evidence_and_transfers` provider delivery evidence. `/api/v1/requests/emergency/readiness`, `/api/v1/requests/emergency/drills`, `/api/v1/requests/emergency/provider-delivery-evidence`, typed frontend client, `/v1/admin/emergency-dispatch` and focused tests now cover queue/readiness/drill/provider evidence. | Continue with external certification and production 24/7 support validation. |
| `DH-58` | Improved, artifact evidence added | Added `v1_045_gis_oss_readiness_exports`, `gisOssReadinessService`, `gis_oss_readiness` feature flag, `/api/v1/gis-oss` routes, admin read/export capabilities, boundary API, export package generation over documents/announcements/protocol files/operational references, `/v1/admin/gis-oss` admin UI and restricted audit classification. Readiness packages now include deterministic JSON artifact metadata, payload SHA-256 manifest, operational evidence, future certified integration markers and `/export-packages/:id/artifact` download evidence. | Continue with staging/prod evidence for real packages and certified provider submission only after accreditation scope is defined. |
| `DH-59` | Improved, rollout evidence added | Added `v1_044_hardware_manual_control_boundaries`, boundary fields on `skud_hardware_devices`, append-only `hardware_manual_control_events`, scoped hardware device APIs, admin boundary updates, guard/admin manual-control event recording, event evidence listing and sensitive audit classification. Provider failure dashboard now aggregates provider health, event failures/retries/dead letters, top errors, hardware fallback state, manual-control evidence and `skud_field_rollout_evidence` via `/api/v1/skud/provider-failures`; admins can record rollout evidence through `/api/v1/skud/field-rollout-evidence`. | Continue with broader live provider pilots and vendor-specific active health probes. |
| `DH-60` | Improved, live report evidence added | Added `v1_041_sensitive_review_ops`, assignment/SLA fields on `sensitive_action_reviews`, `/api/v1/audit/sensitive-actions/_summary`, `_sample`, `_escalate`, `_anti-abuse`, assigned/overdue queue filters, `/api/v1/audit/sensitive-actions/:id/assign`, and `SENSITIVE_REVIEW_RUNNER_ENABLED` runner for sampled review materialization plus overdue/escalation maintenance. Escalation now enqueues `audit.sensitive_review.escalated` rows into `notifications_outbox`, `/api/v1/audit/sensitive-actions/_report-evidence` records/lists real report evidence, and `/v1/admin/sensitive-actions` provides summary KPIs, category filters, anti-abuse findings and pending review queue evidence. | Continue with notification delivery validation and richer anomaly rules. |

## Current Critical Path

Current operating assumption: DomHub has only a test database. The active
execution plan is `docs/product/specs/domhub-test-db-execution-plan.md`.

1. Keep the local critical gate green after every access/content/operations
   change. Latest local verification on 2026-05-20: `cd backend &&
   npm run test:coverage:critical` passed with 32 suites / 629 tests, backend
   contract tests passed with 1 suite / 8 tests, `npm run openapi:drift` passed,
   and `npm run frontend:v1-contract-coverage` passed.
2. Treat the canonical seeded test tenant as the main runtime contour: migrations,
   seed, tenant preflight and E2E must be reproducible from a clean test DB.
   Latest local verification on 2026-05-20 expanded `seedV1Access.js` with
   management-company binding, property admin, technician, contractor,
   canonical topology, vehicles, access request/pass, visit/incident/override,
   outbox and audit evidence; repeated seed runs preserve canonical ids and
   `npm run test:e2e:v1-access` passed 3 Playwright tests.
3. Prove access-core on the seeded tenant before adding scope: resident pass,
   resident vehicle access, admin topology/policy, guard QR/plate verify, manual
   admit/deny, degraded replay and audit evidence.
4. Prove one operations lifecycle on the seeded tenant: resident request, staff
   assignment, technician/contractor action, resident-visible update and
   notification/outbox evidence.
5. Keep Russia readiness, SKUD, GIS/OSS, ERP/1C and emergency provider work as
   adapter/stub/evidence-baseline until a real DB and external provider context
   exist. Do not describe these as production-validated.
6. Keep `DH-62` as post-cutover work: do not remove legacy aliases/runtime paths
   until v1 release gates and replacement modules prove no supported flow depends
   on them.

## Validation Performed

Latest implementation validation used:

- targeted backend Jest for emergency dispatch readiness/drills, resident offboarding reports, GIS/OSS, SKUD hardware/manual-control, SKUD provider failure dashboard, sensitive-action review escalation fanout, migration and audit catalog coverage;
- targeted frontend emergency dispatch, resident offboarding, GIS/OSS, SKUD provider failure and sensitive-action review page/router tests, frontend typecheck compile and ESLint over touched frontend files;
- `tenant:migrate` for `zamoskv`, followed by current-migration preflight showing global/platform/tenant DBs reachable and tenant migrations `63/63`;
- `npm run verify:strict`, including backend tests, frontend lint/typecheck/tests/build, release gate matrix, tenant preflight and `v1-access-production.spec.js`;
- `npm run tenant:restore-drill:preflight`;
- `npm run tenant:restore-drill`, restoring `residenze`, `platform` and `zamoskv` into a pristine Docker Postgres and checking invariants (`users=10`, `properties=1`, `v1 schema_migrations=45`).

Focused backend/frontend checks were executed for recent implementation updates:

- `authz.test.js`
- `v1Routes.test.js`
- `v1PropertyMigrations.test.js`
- `v1AccessTopologyRoutes.test.js`
- `v1AccessTopologyService.test.js`
- `v1AccessRequestsRoute.test.js`
- `v1AccessRequestService.test.js`
- `v1PassService.test.js`
- `v1VisitService.test.js`
- `v1VerifyPassOrchestration.test.js`
- `v1VisitsRoute.test.js`
- `v1ResourceScopeService.test.js`
- `v1VehiclesRoute.test.js`
- `v1AuditEventCatalog.test.js`
- `v1AuditReviewsRoute.test.js`
- `v1AuditReviewService.test.js`
- `v1SensitiveReviewRunner.test.js`
- `v1ResidentOffboardingService.test.js`
- `auth.test.js`
- `auth.coverage.test.js`
- `auth_redis_revocation.test.js`
- `users.test.js`
- `privacy.test.js`
- `requests.test.js`
- `requestSlaService.test.js`
- `emergencyDispatchService.test.js`
- `runtimeJobs.test.js`
- `uploadAccess.test.js`
- `requests_service_validation.test.js`
- `v1PropertyMigrations.test.js`
- `v1StaffWorkspaceRoutes.test.js`
- `npx jest --runInBand --runTestsByPath src/__tests__/requests.test.js src/__tests__/requestSlaService.test.js src/__tests__/uploadAccess.test.js src/__tests__/v1PropertyMigrations.test.js`
- `npx jest --runInBand --runTestsByPath src/__tests__/requests.test.js src/__tests__/requestSlaService.test.js src/__tests__/runtimeJobs.test.js src/__tests__/v1PropertyMigrations.test.js`
- `npx jest --runInBand --runTestsByPath src/__tests__/v1StaffWorkspaceRoutes.test.js`
- `npm --prefix backend run test:coverage:critical`
- `npm --prefix backend test -- --runInBand --runTestsByPath src/__tests__/v1PackagesEndpoint.test.js src/__tests__/v1PackageSlaMetrics.test.js src/v1/workers/__tests__/packageSlaRunner.test.js`
- `npm --prefix backend test -- --runInBand --runTestsByPath src/v1/workers/__tests__/packageSlaRunner.integration.test.js src/v1/services/__tests__/packageSla.integration.test.js`
- `node --check backend/src/middleware/propertyDb.js`
- `node --check backend/src/v1/routes/announcements.js`
- `node --check backend/src/v1/routes/documents.js`
- `npm --prefix backend test -- --runInBand --runTestsByPath src/__tests__/platformDb.test.js src/__tests__/v1AnnouncementsEndpoint.test.js src/__tests__/v1DocumentsEndpoint.test.js src/__tests__/v1AnnouncementsService.test.js src/__tests__/v1DocumentsService.test.js`
- `npm --prefix frontend test -- src/v1/V1Router.test.tsx src/v1/pages/ResidentPages.smoke.test.tsx`
- `npm --prefix frontend run typecheck:compile`
- `.\node_modules\.bin\eslint.cmd src/v1/pages/ResidentAnnouncementsFeedPage.tsx src/v1/pages/ResidentDocumentsPage.tsx src/v1/pages/ResidentPages.smoke.test.tsx` from `frontend/`
- Browser/dev-server smoke opened `http://127.0.0.1:5173/v1/my/announcements` and `http://127.0.0.1:5173/v1/my/documents`
- `npm test -- v1OutboxWorker.test.js --runInBand` from `backend/`
- `npm test -- v1NotificationChannels.test.js --runInBand` from `backend/`
- `npm test -- v1NotificationDispatcher.test.js --runInBand` from `backend/`
- `npm test -- v1NotificationOutbox.test.js --runInBand` from `backend/`
- `npm test -- v1OutboxRunner.test.js --runInBand` from `backend/`
- `npm test -- v1OperationsDashboardService.test.js --runInBand` from `backend/`
- `npm test -- v1OperationsDashboardEndpoint.test.js --runInBand` from `backend/`
- `node .\node_modules\jest\bin\jest.js authz.test.js --runInBand` from `backend/`
- `node .\node_modules\jest\bin\jest.js v1OperationsDashboardService.test.js v1OperationsDashboardEndpoint.test.js --runInBand` from `backend/`
- `node .\node_modules\jest\bin\jest.js v1ManagementCompanyPortfolioService.test.js v1ManagementCompanyPortfolioEndpoint.test.js --runInBand` from `backend/`
- `node .\node_modules\jest\bin\jest.js authz.test.js --runInBand` from `backend/`
- `node .\node_modules\jest\bin\jest.js v1OperationsDashboardService.test.js v1OperationsDashboardEndpoint.test.js --runInBand` from `backend/`
- `node --check src/v1/services/managementCompanyPortfolio.js; node --check src/v1/routes/managementCompanyPortfolio.js; node --check src/v1/services/operationsDashboard.js; node --check src/app/registerApiRoutes.js; node --check src/v1/lib/authz.js` from `backend/`
- `npm test -- src/v1/V1Router.test.tsx src/v1/pages/AdminPages.smoke.test.tsx` from `frontend/`
- `npx tsc --noEmit -p tsconfig.strict.json --pretty false` from `frontend/`
- `.\node_modules\.bin\eslint.cmd src/v1/V1Router.tsx src/v1/V1Router.test.tsx src/v1/api/index.ts src/v1/api/types.ts src/v1/api/operationsDashboard.ts src/v1/pages/OperationsDashboardPage.tsx src/v1/pages/AdminPages.smoke.test.tsx` from `frontend/`
- `npm test -- src/v1/V1Router.test.tsx src/v1/pages/AdminPages.smoke.test.tsx` from `frontend/` covering `DH-37`
- `npx tsc --noEmit -p tsconfig.strict.json --pretty false` from `frontend/`
- `.\node_modules\.bin\eslint.cmd src/v1/V1Router.tsx src/v1/V1Router.test.tsx src/v1/api/index.ts src/v1/api/types.ts src/v1/api/managementCompanyPortfolio.ts src/v1/pages/ManagementCompanyPortfolioPage.tsx src/v1/pages/AdminPages.smoke.test.tsx` from `frontend/`
- `node --check src/routes/platform/properties.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js platformPropertiesPhase1.test.js --runInBand` from `backend/`
- `npx tsc --noEmit -p tsconfig.strict.json --pretty false` from `frontend/`
- `.\node_modules\.bin\eslint.cmd src/admin/pages/PropertyDetailPage.tsx` from `frontend/`
- `node --check src/config/featureFlags.js; node --check src/routes/adminSettings.js; node --check src/routes/platform/properties.js; node --check src/middleware/propertyDb.js; node --check src/v1/services/accessRequestService.js; node --check src/platformMigrations.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js featureFlagsRegistry.test.js v1LegacyUtilitiesFrozen.test.js adminSettingsFeatureFlags.test.js platformPropertiesPhase1.test.js platformMigrations.test.js --runInBand` from `backend/`
- `npx tsc --noEmit -p tsconfig.strict.json --pretty false` from `frontend/`
- `.\node_modules\.bin\eslint.cmd src/contexts/FeatureFlagsContext.tsx src/admin/pages/PropertiesPage.tsx src/admin/pages/PropertyDetailPage.tsx` from `frontend/`
- `npm test -- src/views/AdminFeaturesView/AdminFeaturesView.test.tsx` from `frontend/`
- `node --check src/v1/services/channels/webhookAdapter.js` from `backend/`
- `node --check src/services/webhookService.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js v1NotificationChannels.test.js v1OutboxWorker.test.js v1NotificationDispatcher.test.js webhookService.test.js --runInBand` from `backend/`
- `node --check src/v1/migrations/034_skud_adapter_framework.js` from `backend/`
- `node --check src/v1/services/skudIntegrationService.js` from `backend/`
- `node --check src/services/skud/SkudAdapter.js` from `backend/`
- `node --check src/services/skud/BolidAdapter.js` from `backend/`
- `node --check src/services/skud/HikvisionAdapter.js` from `backend/`
- `node --check src/services/skud/index.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js skudAdapterRegistry.test.js v1SkudIntegrationService.test.js v1PropertyMigrations.test.js --runInBand` from `backend/`
- `node --check src/v1/routes/skudIntegrations.js` from `backend/`
- `node --check src/app/registerApiRoutes.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js skudAdapterRegistry.test.js v1SkudIntegrationService.test.js v1SkudIntegrationsRoute.test.js v1PropertyMigrations.test.js --runInBand` from `backend/`
- `node src/migrate.js` from `backend/` applied `v1_030_request_attachments_updates` and `v1_031_request_assignment_sla`
- `npm --prefix frontend run typecheck:compile`
- `npm --prefix frontend test -- src/v1/V1Router.test.tsx src/v1/pages/AdminPages.smoke.test.tsx`
- `node --check e2e/v1-access-production.spec.js`
- `node --check backend/src/e2e/seedV1Access.js`
- `node --check scripts/run-strict-verify.cjs`
- Playwright spec load/skip check for `e2e/v1-access-production.spec.js` with backend mode disabled
- Backend-backed Playwright run for `e2e/v1-access-production.spec.js` with
  `E2E_BACKEND_MODE=1`, `E2E_V1_ACCESS=1`, and
  `E2E_PROPERTY_TYPE=cottage_community`: 2 tests passed, including DH-20
  onboarding/import/checkpoint/policy/manual-decision smoke
- `node .\node_modules\jest\bin\jest.js --runTestsByPath src\__tests__\v1Routes.test.js src\__tests__\v1ResidentOffboardingService.test.js src\__tests__\v1PropertyMigrations.test.js src\__tests__\v1AuditReviewsRoute.test.js src\__tests__\v1AuditReviewService.test.js src\__tests__\v1SensitiveReviewRunner.test.js --runInBand` from `backend/`: 6 suites, 219 tests passed
- `node .\node_modules\jest\bin\jest.js --runTestsByPath src\__tests__\requests.test.js src\__tests__\requestSlaService.test.js src\__tests__\emergencyDispatchService.test.js src\__tests__\v1PropertyMigrations.test.js --runInBand` from `backend/`: 4 suites, 210 tests passed
- `node --check` for `src\v1\services\gisOssReadinessService.js`, `src\v1\routes\gisOssReadiness.js`, `src\v1\migrations\045_gis_oss_readiness_exports.js`, `src\v1\lib\authz.js`, `src\v1\services\auditEventCatalog.js`, `src\v1\migrations\index.js`, `src\config\featureFlags.js` and `src\app\registerApiRoutes.js` from `backend/`
- `node .\node_modules\jest\bin\jest.js featureFlagsRegistry.test.js adminSettingsFeatureFlags.test.js v1GisOssReadinessService.test.js v1GisOssReadinessRoute.test.js v1PropertyMigrations.test.js v1AuditEventCatalog.test.js v1SkudIntegrationService.test.js v1SkudIntegrationsRoute.test.js --runInBand` from `backend/`: 8 suites, 215 tests passed
- `npm test -- src/v1/pages/GisOssReadinessPage.test.tsx src/v1/V1Router.test.tsx` from `frontend/`: 2 files, 26 tests passed
- `npm run typecheck:compile` from `frontend/`
- `.\node_modules\.bin\eslint.cmd src/v1/V1Router.tsx src/v1/V1Router.test.tsx src/v1/api/index.ts src/v1/api/types.ts src/v1/api/gisOssReadiness.ts src/v1/pages/GisOssReadinessPage.tsx src/v1/pages/GisOssReadinessPage.test.tsx src/contexts/FeatureFlagsContext.tsx` from `frontend/`
- `npm run verify:strict` from root reached backend/frontend test/build gates but failed at tenant preflight because local Postgres on `localhost:5432` was unreachable; Docker Desktop engine also did not become ready locally.
- `node --check backend\src\services\requests\EmergencyDispatchService.js; node --check backend\src\routes\requests.js; node --check backend\src\v1\migrations\046_emergency_readiness_evidence.js; node --check backend\src\v1\migrations\index.js`
- `node .\node_modules\jest\bin\jest.js emergencyDispatchService.test.js requests.test.js v1PropertyMigrations.test.js v1ResidentOffboardingService.test.js v1Routes.test.js v1SkudIntegrationService.test.js v1SkudIntegrationsRoute.test.js v1AuditReviewService.test.js v1AuditReviewsRoute.test.js v1GisOssReadinessService.test.js v1GisOssReadinessRoute.test.js --runInBand` from `backend/`: 11 suites, 317 tests passed
- `npm test -- src\v1\pages\EmergencyDispatchPage.test.tsx src\v1\pages\ResidentOffboardingReportPage.test.tsx src\v1\pages\SkudProviderFailuresPage.test.tsx src\v1\pages\SensitiveActionsReviewPage.test.tsx src\v1\pages\GisOssReadinessPage.test.tsx src\v1\V1Router.test.tsx` from `frontend/`: 6 files, 41 tests passed
- `npx eslint` over touched emergency/offboarding/GIS/SKUD/sensitive frontend pages, router, API clients and shared types from `frontend/`
- `npm run typecheck:compile` from `frontend/`

No additional full runtime suite was executed after the latest DH-57 changes; latest validation is focused backend/frontend plus the earlier strict/restore checks noted above.
