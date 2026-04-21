# DomHub First Working MVP Checklist

This document is the practical checklist for getting DomHub from planning-ready state to a first working MVP that can be demonstrated, tested end-to-end, and prepared for a pilot.

It is intentionally narrower than the full product roadmap.

The objective is not to ship the full DomHub platform. The objective is to ship one reliable first working version of the core product.

## MVP Outcome

At the end of this checklist, DomHub should support:

- resident self-service for guest access;
- resident self-service for vehicle access;
- security workspace for allow, deny, and manual override;
- staff request handling baseline;
- property admin visibility into the object;
- basic multi-tenant object model;
- audit trail and event visibility;
- first notification baseline;
- a demo-ready and pilot-ready first vertical slice.

## Out Of Scope For First Working MVP

These should not block the first working MVP:

- advanced billing;
- booking modules;
- OCR;
- white-label expansion;
- deep ERP/1C sync;
- production-grade video evidence workflows;
- broad SKUD vendor matrix;
- advanced portfolio analytics;
- expansion modules beyond the core pilot.

## Section 1 - Freeze The MVP Scope

- [ ] Confirm the first working MVP role set:
  - `resident`
  - `security`
  - `concierge/staff`
  - `property_admin`
- [ ] Confirm the first working MVP object model:
  - `management_company`
  - `property`
  - `building`
  - `entrance`
  - `unit`
- [ ] Confirm the first working MVP access features:
  - guest pass
  - vehicle pass
  - QR/token pass
  - allow/deny/manual override
  - visit log
  - access incident baseline
- [ ] Confirm the first working MVP request features:
  - resident request creation
  - staff queue
  - request detail
  - assignment/status change baseline
- [ ] Confirm the first working MVP admin features:
  - property dashboard
  - access visibility
  - request visibility
  - incident visibility
- [ ] Explicitly mark everything else as `after MVP`.

## Section 2 - Establish The Visual Source Of Truth

- [ ] Create the main DomHub Figma file.
- [ ] Create the minimal page structure:
  - `00 Cover`
  - `01 Foundations`
  - `02 Components`
  - `04 Resident`
  - `05 Security`
  - `06 Concierge & Staff`
  - `08 Property Admin`
  - `12 Prototype Flows`
- [ ] Port first visual foundations from the token spec.
- [ ] Build first components:
  - `Button`
  - `Input`
  - `Search Input`
  - `Card`
  - `Panel`
  - `Status Pill`
  - `Top Bar`
  - `Sidebar`
  - `Bottom Nav`
  - `Metric Card`
  - `Queue Row`
  - `Pass Row`
  - `Vehicle Row`
  - `Detail Side Panel`
  - `Alert Banner`
  - `Scan Result Panel`
  - `Allow Deny Block`
- [ ] Finish first critical screens:
  - `Resident / Home`
  - `Resident / Guest Pass / Form`
  - `Resident / Guest Pass / Success`
  - `Resident / Vehicle Pass / Form`
  - `Resident / Vehicle Pass / Success`
  - `Security / Workspace / Default`
  - `Security / Workspace / QR Result / Allowed`
  - `Security / Workspace / QR Result / Denied`
  - `Staff / Request Queue`
  - `Property Admin / Dashboard`
- [ ] Add annotations for role, purpose, related React target, and status.
- [ ] Freeze the first implementation-ready screen set.

## Section 3 - Backend Core Domain

- [ ] Implement tenant and property foundations.
- [ ] Implement role and membership model.
- [ ] Implement resident, staff, and contractor baseline entities.
- [ ] Implement vehicle entity and ownership rules.
- [ ] Implement access request entity and lifecycle.
- [ ] Implement pass entity and lifecycle.
- [ ] Implement visit log and access event recording.
- [ ] Implement access incident baseline.
- [ ] Implement request entity and request lifecycle baseline.
- [ ] Implement audit event recording for critical mutations.
- [ ] Verify property and tenant scope enforcement across the domain.

## Section 4 - API And Permissions

- [ ] Expose the first working `/api/v1/*` routes for:
  - resident access requests
  - passes
  - vehicles
  - security actions
  - request queue
  - property dashboard data
- [ ] Apply role-aware authorization checks.
- [ ] Apply property/company scope checks.
- [ ] Validate state transitions against the state machine spec.
- [ ] Ensure all destructive or high-risk actions are auditable.
- [ ] Ensure no MVP flow depends on deprecated `/api/*` aliases.

## Section 5 - Frontend Vertical Slice

- [ ] Implement `Resident Home`.
- [ ] Implement guest pass creation flow.
- [ ] Implement vehicle pass creation flow.
- [ ] Implement resident pass success views.
- [ ] Implement `Security Workspace`.
- [ ] Implement QR result allowed view.
- [ ] Implement QR result denied view.
- [ ] Implement manual override interaction.
- [ ] Implement `Staff Request Queue`.
- [ ] Implement request detail side panel.
- [ ] Implement `Property Admin Dashboard`.
- [ ] Align implementation with:
  - `frontend/src/styles/ds-tokens.css`
  - `domhub-react-figma-component-map.md`
- [ ] Keep component extraction consistent with the first design system layer.

## Section 6 - Notifications And Basic Integrations

- [ ] Implement push/SMS/Telegram notification abstraction baseline.
- [ ] Support pass-related notifications.
- [ ] Support request-related notifications.
- [ ] Support incident/admin alert notifications.
- [ ] Add CSV import baseline for:
  - units
  - residents
  - staff
  - vehicles if needed for pilot
- [ ] Add at least one mock access integration path for future SKUD alignment.

## Section 7 - Infrastructure And Security Baseline

- [ ] Verify authentication model for MVP users.
- [ ] Verify refresh/session behavior.
- [ ] Verify tenant isolation.
- [ ] Verify secrets and config strategy.
- [ ] Verify database migrations run cleanly.
- [ ] Verify upload/file strategy if the MVP needs request attachments.
- [ ] Verify structured logging for critical flows.
- [ ] Verify error handling and monitoring baseline.
- [ ] Verify staging environment exists and is usable.
- [ ] Verify backup and restore baseline exists for pilot confidence.

## Section 8 - Test And Release Readiness

- [ ] Add unit tests for core domain services.
- [ ] Add integration tests for access lifecycle.
- [ ] Add integration tests for request lifecycle.
- [ ] Add authorization tests for role boundaries.
- [ ] Add tenant isolation tests for critical flows.
- [ ] Add frontend tests or E2E smoke tests for:
  - resident guest pass flow
  - resident vehicle pass flow
  - security allow/deny flow
  - staff request handling flow
- [ ] Run root checks:
  - `npm run test`
  - `npm run e2e`
- [ ] Run backend checks:
  - `npm run test:ci`
  - `npm run test:coverage:critical`
- [ ] Run frontend checks:
  - `npm run lint`
  - `npm run typecheck`
- [ ] Fix all MVP-blocking failures before pilot packaging.

## Section 9 - Demo And Pilot Readiness

- [ ] Prepare seeded demo data for one realistic property.
- [ ] Prepare demo residents, guests, vehicles, staff, and incidents.
- [ ] Validate one end-to-end happy path:
  - resident creates guest pass
  - security validates pass
  - pass is allowed
  - event is logged
- [ ] Validate one denied access path.
- [ ] Validate one manual override path.
- [ ] Validate one resident request path from creation to staff action.
- [ ] Validate one property admin review path.
- [ ] Prepare a launch checklist for one pilot object.
- [ ] Prepare support notes for resident/security/admin users.

## Section 10 - Launch Gates

### Gate A - Scope Freeze

- [ ] MVP scope is frozen.
- [ ] Non-MVP modules are explicitly deferred.

### Gate B - Visual Freeze

- [ ] First critical screens exist in Figma.
- [ ] First shared components exist in Figma.
- [ ] Screens are annotated and implementable.

### Gate C - Working Core Slice

- [ ] Resident pass flow works end to end.
- [ ] Vehicle flow works end to end.
- [ ] Security flow works end to end.
- [ ] Request flow works end to end.
- [ ] Property admin visibility works end to end.

### Gate D - Technical Readiness

- [ ] Authorization is enforced.
- [ ] Tenant boundaries are enforced.
- [ ] Audit events exist for critical actions.
- [ ] Tests pass at MVP gate level.
- [ ] Staging environment is usable.

### Gate E - Pilot Readiness

- [ ] Demo data is ready.
- [ ] Pilot flow has been rehearsed.
- [ ] Support and onboarding notes exist.
- [ ] Team knows what is in and out of scope.

## Final Definition Of Done

DomHub has reached the first working MVP only when all of the following are true:

- the MVP scope is frozen;
- the first visual source of truth exists in Figma;
- the first access and request flows work end to end;
- the first admin view works end to end;
- the app can be run in staging;
- the core tests pass;
- the team can demo and rehearse a first object launch without inventing missing product behavior during the demo.
