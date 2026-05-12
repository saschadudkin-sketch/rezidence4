# DomHub Figma Plan

Date: 2026-05-11
Status: Draft for confirmation
Owner: Product/design handoff
Figma file: https://www.figma.com/design/NznvSvCsAcMU3GArCh9fuJ/Untitled?node-id=1-6380

## 1. Purpose

This document defines the practical plan for creating the first DomHub Figma product UI file when no Figma file exists yet.

It does not replace the product roadmap or existing Figma reference docs. It connects them into an execution-ready design brief:

- what Figma file structure to create;
- which screens to design first;
- which reusable components must exist before screen work scales;
- how each screen maps back to product scope and frontend implementation;
- what must be checked before a Figma screen is considered ready for React implementation.

## 2. Source Of Truth

Use these documents as the product and delivery baseline:

- `docs/product/specs/domhub-final-product-plan.md`
- `docs/product/specs/domhub-ui-screen-map.md`
- `docs/product/specs/domhub-figma-file-template.md`
- `docs/product/specs/domhub-figma-component-library-structure.md`
- `docs/product/specs/domhub-design-tokens-css-spec.md`
- `docs/product/specs/domhub-react-figma-component-map.md`
- `docs/product/specs/domhub-7-day-figma-transition-checklist.md`
- `docs/product/specs/domhub-backlog-epics.md`

Use these frontend references as the implementation reality:

- `frontend/src/App.tsx`
- `frontend/src/v1/V1Router.tsx`
- `frontend/src/v1/components/ui/index.tsx`
- `frontend/src/design-system/components/`
- `frontend/src/styles/tokens.css`
- `frontend/src/design-system/tokens.css`

## 3. Design Context

Target audience:

- residents using mobile-first self-service;
- security and concierge staff working under time pressure;
- technicians and contractors handling assigned work;
- property admins managing one property;
- management company admins reviewing a portfolio;
- platform admins handling tenant and property setup.

Core use cases:

- create and manage resident access and guest passes;
- admit, deny, scan, and reconcile visits at security posts;
- handle service requests through staff, technician, and contractor workflows;
- publish resident communication and documents;
- oversee property operations, access policies, onboarding, and portfolio health.

Brand and interface tone:

- quiet luxury operations;
- premium residential service;
- operational clarity over decoration;
- calm, trustworthy, precise, and role-aware.

Theme direction:

- Figma should start from the light-first token direction in `domhub-design-tokens-css-spec.md`;
- current frontend still contains a premium dark theme layer in `frontend/src/design-system/tokens.css` and older dark-first copy in `frontend/src/design-system/README.md`;
- treat dark UI as secondary mode or role-specific operations mode until the token direction is reconciled.

## 4. Figma File Structure

Create one file first:

```text
DomHub Product UI
```

Do not split by role in the first pass. Use pages:

```text
00 Cover
01 Foundations
02 Components
03 Patterns
04 Resident
05 Security
06 Concierge & Staff
07 Technician & Contractor
08 Property Admin
09 Management Company
10 Platform Admin
11 Prototype Flows
12 Archive
```

Rules:

- foundations live only in `01 Foundations`;
- reusable components live only in `02 Components`;
- role screens stay on their role pages;
- repeated layout structures live in `03 Patterns`;
- exploratory frames must be clearly marked `Exploration`;
- implementation-ready frames must be marked `Approved For First Implementation`;
- do not duplicate reusable components inside screen pages.

## 5. First Design Package

The first package should cover the smallest set of screens that proves the product experience across resident, operations, and admin roles.

### Package A - Required Screens

```text
Auth / Login
Resident / Access Home
Resident / Guest Pass / Form
Resident / Guest Pass / Success
Security / Guard Console / Default
Security / Guard Console / Allowed Result
Security / Guard Console / Denied Result
Staff / Request Queue
Staff / Request Detail
Property Admin / Operations Dashboard
Management Company / Portfolio Dashboard
Platform Admin / Tenant Dashboard
```

### Package A - Why These Screens

- `Auth / Login` anchors first impression and session restore states.
- `Resident / Access Home` proves mobile-first resident value.
- `Resident / Guest Pass` proves the main resident self-service flow.
- `Security / Guard Console` proves real-time, low-click operational UX.
- `Staff / Request Queue` and `Staff / Request Detail` prove the request lifecycle.
- `Property Admin / Operations Dashboard` proves one-property oversight.
- `Management Company / Portfolio Dashboard` proves multi-property value.
- `Platform Admin / Tenant Dashboard` proves tenant setup and support scope without mixing into daily operations.

## 6. Current Frontend Mapping

### Legacy/App Shell Surfaces

From `frontend/src/App.tsx`:

```text
/dashboard/*
/guard/scan
/p/:token
/design-system
```

Relevant current views:

```text
frontend/src/views/Login.tsx
frontend/src/views/Dashboard.tsx
frontend/src/views/ResidentView.tsx
frontend/src/views/SecurityConciergeViews.tsx
frontend/src/views/AdminView.tsx
frontend/src/views/guard/GuardScannerView.tsx
frontend/src/views/public/GuestPassPage.tsx
```

### Platform v1 Surfaces

From `frontend/src/v1/V1Router.tsx`:

```text
/v1/access
/v1/my/packages
/v1/my/announcements
/v1/my/documents
/v1/guard
/v1/staff-workspace
/v1/requests/:id
/v1/technician-workspace
/v1/contractor-workspace
/v1/admin/operations
/v1/admin/access
/v1/admin/gis-oss
/v1/onboarding
/v1/portfolio
/v1/announcements
/v1/packages
/v1/documents
```

Package A should primarily use the platform-v1 surfaces as the forward-looking design target, while noting legacy equivalents where implementation still depends on them.

## 7. Component Plan

### Existing React Components

Currently available in `frontend/src/design-system/components/`:

```text
Avatar
Badge
Button
Card
EmptyState
Input
Spinner
StatusPill
```

Platform-v1 primitives in `frontend/src/v1/components/ui/index.tsx`:

```text
Button
Input
Select
Textarea
Field
Card
Badge
Spinner
EmptyState
Alert
Stack
Inline
Toolbar
```

### First Figma Components

Build these before or alongside Package A screens:

```text
Button
Icon Button
Input
Search Input
Select
Textarea
Field Group
Card
Panel
Badge
Status Pill
Alert
Toast
Empty State
Spinner
Top Bar
Sidebar
Bottom Nav
Tabs
Filter Bar
Metric Card
Queue Row
Request Card
Request Detail Panel
Pass Card
Vehicle Row
Access Event Row
Scan Result Panel
Allow Deny Block
Resident Quick View
Detail Side Panel
Entity Header
KPI Strip
```

### Variant Axes

Use consistent variants:

```text
size: sm | md | lg
state: default | hover | focus | disabled | selected | loading
tone: neutral | success | warning | danger | info | brand
density: resident | staff | security | admin | company
mode: light | dark
```

## 8. Foundations To Port Into Figma

Start from `domhub-design-tokens-css-spec.md`:

- brand forest colors;
- warm ivory surfaces;
- graphite text;
- restrained gold accent;
- semantic success, warning, danger, info states;
- surface, text, border, and button semantic tokens;
- type scale for display, heading, body, label, and metrics;
- spacing scale;
- radius scale;
- shadow scale;
- role density tokens.

Also document current frontend token drift:

- `frontend/src/styles/tokens.css` supports dark and light through app-level variables;
- `frontend/src/design-system/tokens.css` is still dark-first;
- the Figma source should make the intended semantic token contract clear before broad UI refactoring.

## 9. Screen Briefs

### Auth / Login

Primary user action:

- enter phone/session credentials and continue into the correct role experience.

Must include states:

- default;
- loading;
- auth notice;
- configuration error;
- mobile short viewport;
- invalid OTP or failed login.

Frontend targets:

- `frontend/src/views/Login.tsx`
- `frontend/src/views/login/LoginPhoneStep.tsx`
- `frontend/src/views/login/LoginOtpStep.tsx`

### Resident / Access Home

Primary user action:

- understand active access state and create a new guest or vehicle pass.

Layout direction:

- mobile-first;
- clear top identity/property context;
- quick actions near the top;
- active passes and requests visible without deep navigation;
- announcements/documents secondary.

Must include states:

- no active passes;
- active guest pass;
- active vehicle pass;
- pending request;
- denied or expired pass;
- offline/degraded update state.

Frontend targets:

- `frontend/src/v1/pages/ResidentAccessPage.tsx`
- `frontend/src/v1/components/PassCard.tsx`
- `frontend/src/v1/components/AccessRequestCard.tsx`
- `frontend/src/views/ResidentView.tsx`

### Resident / Guest Pass / Form

Primary user action:

- create an access request with minimal friction.

Must include:

- visitor name;
- phone;
- access type;
- date/time window;
- vehicle data when relevant;
- validation errors;
- submit loading;
- success result with shareable status.

Frontend targets:

- `frontend/src/v1/components/AccessRequestForm.tsx`
- `frontend/src/views/resident/PassReadySheet.tsx`

### Security / Guard Console

Primary user action:

- decide admit, deny, or escalate quickly after scan/search.

Layout direction:

- high contrast within the same brand system;
- large action targets;
- minimal reading before decision;
- recent events visible but secondary;
- manual override available without dominating default state.

Must include states:

- default queue;
- QR allowed;
- QR denied;
- vehicle lookup allowed;
- vehicle lookup denied;
- manual entry;
- offline/degraded mode;
- pending reconciliation.

Frontend targets:

- `frontend/src/v1/pages/GuardConsolePage.tsx`
- `frontend/src/v1/components/ScanPanel.tsx`
- `frontend/src/v1/components/VerifyResultCard.tsx`
- `frontend/src/views/guard/GuardScannerView.tsx`

### Staff / Request Queue

Primary user action:

- identify priority work and open the correct request.

Layout direction:

- dense but readable;
- filterable by status, urgency, assignment, and SLA;
- emergency state visually distinct from normal backlog;
- queue and detail panel pattern should scale to desktop.

Must include states:

- default queue;
- empty queue;
- loading;
- API error;
- emergency request;
- stale update or conflict warning;
- selected request.

Frontend targets:

- `frontend/src/v1/pages/StaffWorkspacePage.tsx`
- `frontend/src/v1/pages/ConciergeRequestDetailPage.tsx`
- `frontend/src/views/SecurityConciergeViews.tsx`

### Staff / Request Detail

Primary user action:

- move a request to the next correct workflow status.

Must include:

- resident-visible summary;
- internal notes;
- attachments/photos;
- assignee;
- status transition controls;
- conflict/stale status handling;
- resident quick view;
- audit-sensitive state changes.

Frontend targets:

- `frontend/src/v1/pages/ConciergeRequestDetailPage.tsx`
- `frontend/src/domain/requestWorkflow.ts`

### Property Admin / Operations Dashboard

Primary user action:

- understand property health and act on operational exceptions.

Must include:

- SLA/backlog overview;
- emergency queue summary;
- access health;
- staff/contractor workload;
- announcements/documents shortcuts;
- integration/device health where enabled.

Frontend targets:

- `frontend/src/v1/pages/OperationsDashboardPage.tsx`
- `frontend/src/v1/pages/AccessAdminPage.tsx`

### Management Company / Portfolio Dashboard

Primary user action:

- compare properties and drill into problem objects.

Must include:

- portfolio status;
- cross-property SLA/backlog;
- incident visibility;
- property comparison table;
- trend containers;
- export/report entry points.

Frontend target:

- `frontend/src/v1/pages/ManagementCompanyPortfolioPage.tsx`

### Platform Admin / Tenant Dashboard

Primary user action:

- manage tenant setup, property lifecycle, and platform support visibility.

Must include:

- management company registry;
- property registry;
- tenant health;
- feature/package gating;
- audit log access;
- admin user management.

Frontend targets:

- `frontend/src/admin/App.tsx`
- `frontend/src/admin/pages/DashboardPage.tsx`
- `frontend/src/admin/pages/PropertiesPage.tsx`
- `frontend/src/admin/pages/ManagementCompaniesPage.tsx`
- `frontend/src/admin/pages/AuditLogPage.tsx`

## 10. Prototype Flows

Create these flows in `11 Prototype Flows`:

```text
Flow / Resident Guest Pass
Flow / Security Allow Deny
Flow / Staff Request Handling
Flow / Property Admin Operations Review
Flow / Management Company Portfolio Review
Flow / Platform Tenant Setup
```

Each flow should include:

- entry point;
- happy path;
- one empty state;
- one error or degraded state;
- final confirmation or completion state;
- related frontend route;
- related product spec.

## 11. Frame Annotation Template

Every implementation-target screen frame should include a small annotation block:

```text
Role:
Purpose:
Primary action:
Frontend target:
Related spec:
Data required:
States covered:
Status:
Open questions:
```

Allowed status labels:

```text
Exploration
Draft
Review
Approved For First Implementation
Deprecated
```

## 12. Responsive Targets

Design at least these frame sizes:

```text
Mobile resident: 390 x 844
Mobile compact: 360 x 780
Tablet: 768 x 1024
Desktop operations: 1440 x 1024
Wide admin: 1680 x 1050
```

Role emphasis:

- resident: mobile-first;
- security: tablet and desktop station first, with large controls;
- staff/admin/company: desktop-first, with responsive collapse rules;
- platform admin: desktop-first.

## 13. Readiness Checklist

A screen is ready for implementation only when:

- it maps to a role in `domhub-ui-screen-map.md`;
- it uses shared components instead of local one-off drawings;
- it uses semantic tokens from the foundation page;
- it includes loading, empty, error, and relevant permission states;
- it covers offline/degraded states when the workflow depends on realtime or network access;
- emergency and danger states are visually distinct and accessible;
- sensitive fields are masked or hidden for insufficient roles;
- copy is final enough for implementation;
- the related frontend route/component target is documented;
- the frame status is `Approved For First Implementation`.

## 14. Execution Plan

### Day 0 - Prepare

- create `DomHub Product UI`;
- add pages and cover;
- paste source-of-truth links;
- add the design direction note from this document.

### Day 1 - Foundations

- port colors, typography, spacing, radius, shadows, and role density;
- document light-first decision and dark-mode drift;
- define semantic color names before drawing screens.

### Day 2 - Components

- build primitives and first product patterns;
- add variants and states;
- map each component to React availability: existing, v1 primitive, or needed.

### Day 3 - Resident

- design resident access home;
- design guest pass form;
- design guest pass success/share state.

### Day 4 - Security And Staff

- design guard console default/allowed/denied;
- design staff request queue;
- design request detail.

### Day 5 - Admin And Portfolio

- design property operations dashboard;
- design management company portfolio dashboard;
- design platform tenant dashboard.

### Day 6 - Prototype And QA

- connect prototype flows;
- run readiness checklist;
- identify missing React components;
- mark screens as `Review` or `Approved For First Implementation`.

## 15. Open Questions

These do not block the first draft, but should be resolved before final Figma approval:

- Is light-first the confirmed default for the product UI, or should security/operations stay dark-first?
- Which real property name and demo data should appear in the first Figma file?
- Is the current DomHub logo final, or should Figma use a text lockup until brand work is complete?
- Which font family should replace the transitional frontend mix if the product moves beyond MVP?
- Should Package A prioritize platform-v1 surfaces only, or also redesign legacy `/dashboard/*` screens for migration continuity?

## 16. Immediate Next Step

Create the Figma file with the page structure in section 4, then build `01 Foundations` and `02 Components` before drawing role screens.

If a Figma file becomes available, use this document as the checklist for the first automated or manual Figma pass.
