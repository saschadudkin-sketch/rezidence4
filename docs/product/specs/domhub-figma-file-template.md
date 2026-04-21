# DomHub Figma File Template

This document defines the recommended starting template for the main DomHub Figma product file.

It is optimized for:

- one primary product file;
- Figma Starter-level setup;
- multi-role product design;
- clean handoff into frontend implementation;
- controlled growth without page chaos.

Use this together with:

- `domhub-7-day-figma-transition-checklist.md`
- `domhub-figma-component-library-structure.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`

## File Naming

Recommended main file name:

- `DomHub Product UI`

If versioning is needed later:

- `DomHub Product UI v1`
- `DomHub Product UI v2`

Do not create separate files for each role in the first stage.

## File Cover

Create a first page cover frame with:

- product name;
- short positioning statement;
- supported roles;
- current design direction;
- links or references to the main product docs;
- update note:
  - `Visual source of truth for first-wave DomHub product UI`

Recommended cover title:

- `DomHub`
- subtitle: `Premium residential operations platform`

## Recommended Page Structure

Use this exact order at the start.

### `00 Cover`

Purpose:

- file orientation;
- short source-of-truth note;
- current visual direction;
- contribution rules.

Recommended frames:

- `File Cover`
- `Product Positioning`
- `Roles Overview`
- `Current Visual Direction`
- `Source Of Truth`

### `01 Foundations`

Purpose:

- design tokens and visual primitives.

Recommended sections:

- color variables;
- typography;
- spacing;
- radius;
- shadows;
- borders;
- motion guidance;
- density guidance by role.

Recommended frames:

- `Foundations / Color`
- `Foundations / Typography`
- `Foundations / Spacing`
- `Foundations / Radius`
- `Foundations / Shadows`
- `Foundations / Borders`
- `Foundations / Motion`
- `Foundations / Role Density`

### `02 Components`

Purpose:

- reusable building blocks.

Recommended frame groups:

- `Components / Actions`
- `Components / Inputs`
- `Components / Navigation`
- `Components / Data Display`
- `Components / Feedback`
- `Components / Domain`
- `Components / Dashboard`

Recommended first component frames:

- `Button / Primary / Default`
- `Button / Secondary / Default`
- `Button / Danger / Default`
- `Icon Button / Default`
- `Input / Default`
- `Search Input / Default`
- `Select / Default`
- `Card / Default`
- `Panel / Default`
- `Status Pill / Default`
- `Badge / Default`
- `Top Bar / Resident`
- `Top Bar / Operations`
- `Sidebar / Default`
- `Bottom Nav / Resident`
- `Metric Card / Default`
- `Alert Banner / Info`
- `Alert Banner / Warning`
- `Alert Banner / Danger`
- `Queue Row / Default`
- `Pass Row / Default`
- `Vehicle Row / Default`
- `Incident Card / Default`
- `Detail Side Panel / Default`
- `Scan Result Panel / Allowed`
- `Scan Result Panel / Denied`
- `Allow Deny Block / Default`
- `Policy Card / Default`

### `03 Patterns`

Purpose:

- repeatable layout structures above single components but below full screens.

Recommended frames:

- `Pattern / Mobile Resident Shell`
- `Pattern / Desktop Operations Shell`
- `Pattern / Dashboard Shell`
- `Pattern / Queue With Detail Panel`
- `Pattern / KPI Strip`
- `Pattern / Problem List`
- `Pattern / Search + Filters`
- `Pattern / Entity Header`

### `04 Resident`

Purpose:

- resident-facing mobile-first experience.

Recommended frames:

- `Resident / Home`
- `Resident / Guest Pass / Form`
- `Resident / Guest Pass / Success`
- `Resident / Vehicle Pass / Form`
- `Resident / Vehicle Pass / Success`
- `Resident / Requests / Create`
- `Resident / Requests / List`
- `Resident / Announcements`
- `Resident / Documents`
- `Resident / Profile`

### `05 Security`

Purpose:

- high-speed guard and checkpoint operations.

Recommended frames:

- `Security / Workspace / Default`
- `Security / Workspace / QR Result / Allowed`
- `Security / Workspace / QR Result / Denied`
- `Security / Workspace / Vehicle Search`
- `Security / Workspace / Manual Override`
- `Security / Incidents / List`
- `Security / Incidents / Detail`

### `06 Concierge & Staff`

Purpose:

- service queue and front-desk operations.

Recommended frames:

- `Staff / Request Queue`
- `Staff / Request Detail`
- `Concierge / Workspace`
- `Concierge / Packages`
- `Concierge / Resident Quick View`

### `07 Technician & Contractor`

Purpose:

- field work and assigned operational execution.

Recommended frames:

- `Technician / Assigned Tasks`
- `Technician / Task Detail`
- `Technician / Resolution`
- `Contractor / Assigned Jobs`
- `Contractor / Job Detail`

### `08 Property Admin`

Purpose:

- control room for a single property.

Recommended frames:

- `Property Admin / Dashboard`
- `Property Admin / Requests`
- `Property Admin / Access Rules`
- `Property Admin / Access Zones`
- `Property Admin / Access Points`
- `Property Admin / Contractors`
- `Property Admin / Staff`
- `Property Admin / Incidents`
- `Property Admin / Notifications`
- `Property Admin / Settings`

### `09 Management Company`

Purpose:

- portfolio and multi-property oversight.

Recommended frames:

- `Company Admin / Portfolio Dashboard`
- `Company Admin / Properties List`
- `Company Admin / Property Comparison`
- `Company Admin / Portfolio Incidents`
- `Company Admin / Portfolio Analytics`
- `Company Admin / Standards & Policies`

### `10 Platform Admin`

Purpose:

- cross-platform governance and operational administration.

Recommended frames:

- `Platform Admin / Registry`
- `Platform Admin / Property Lifecycle`
- `Platform Admin / Feature Flags`
- `Platform Admin / Health Overview`

### `11 Onboarding`

Purpose:

- property setup and launch operations.

Recommended frames:

- `Onboarding / Create Property`
- `Onboarding / Import Structure`
- `Onboarding / Import Residents`
- `Onboarding / Import Staff`
- `Onboarding / Launch Checklist`

### `12 Prototype Flows`

Purpose:

- stitched flows for review and early testing.

Recommended frames:

- `Flow / Resident Guest Pass`
- `Flow / Security Allow Deny`
- `Flow / Staff Request Handling`
- `Flow / Contractor Access`
- `Flow / Property Admin Daily Review`

## First-Week Minimal Template

If the file needs to stay very lean in week one, create only these pages first:

- `00 Cover`
- `01 Foundations`
- `02 Components`
- `03 Patterns`
- `04 Resident`
- `05 Security`
- `06 Concierge & Staff`
- `08 Property Admin`
- `09 Management Company`
- `12 Prototype Flows`

## Frame Size Guidance

Use clear frame defaults to avoid arbitrary sizing.

### Mobile Frames

Use for resident:

- `390 x 844`
- `393 x 852`

Choose one mobile reference and keep it consistent.

### Desktop Frames

Use for operations/admin:

- `1440 x 1024`

Optional wide dashboard variant:

- `1600 x 1100`

Do not mix too many desktop sizes in the same first-wave file.

## Section Header Template

Every major screen page should start with a simple section header frame containing:

- role;
- screen set name;
- short UX purpose;
- current status:
  - `Draft`
  - `Review`
  - `Approved For First Implementation`

Recommended header format:

- title: `Resident`
- subtitle: `Premium self-service for access and requests`

## Annotation Template

Each critical first-wave screen should include a small annotation block outside the main frame.

Recommended annotation fields:

- `Role`
- `Purpose`
- `Primary actions`
- `Main data shown`
- `Related React target`
- `Related doc`

Example:

- `Role: Security`
- `Purpose: Real-time checkpoint decision interface`
- `Related React target: SecurityWorkspacePage`
- `Related doc: domhub-react-figma-component-map.md`

## First Screens To Build

These should appear first in the file:

- `Resident / Home`
- `Resident / Guest Pass / Form`
- `Resident / Guest Pass / Success`
- `Security / Workspace / Default`
- `Security / Workspace / QR Result / Allowed`
- `Security / Workspace / QR Result / Denied`
- `Staff / Request Queue`
- `Property Admin / Dashboard`
- `Company Admin / Portfolio Dashboard`

## First Components To Build

These should exist before most screens expand:

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

## File Hygiene Rules

- Keep foundations separate from components.
- Keep components separate from screens.
- Keep role-specific screens grouped by page.
- Do not duplicate components inside role pages when they should live in `02 Components`.
- Do not create multiple competing component names for the same pattern.
- Do not let exploration frames mix with approved implementation screens.

## Status Labels

Use consistent labels on screen headers:

- `Exploration`
- `Draft`
- `Review`
- `Approved For First Implementation`
- `Deprecated`

## Handoff Rule

When a screen is ready for frontend implementation:

- it must use shared components or clearly reference them;
- spacing and token usage must be consistent;
- screen purpose must be annotated;
- the matching React/component mapping must be clear.

Do not hand off exploratory frames directly into implementation.

## Final Check

The Figma file template is correct when:

- a new contributor can understand where to place anything in under five minutes;
- the first role screens are easy to find;
- the foundations/components/patterns/screens split is clear;
- the file can scale without becoming a visual dumping ground.
