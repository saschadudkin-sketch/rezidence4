# DomHub 7-Day Claude-To-Figma Transition Checklist

This document defines the practical 7-day transition from Claude-led product exploration to a usable Figma Starter workflow for DomHub.

The goal is not to fully finish the design system in one week. The goal is to establish a clean Figma source of truth for the first critical DomHub screens and shared component foundations.

## Transition Goal

At the end of 7 days, DomHub should have:

- one working Figma file with a stable page structure;
- foundational visual tokens reflected in Figma;
- the first critical role screens in high fidelity;
- a reusable first-wave component set;
- a clear handoff path from Figma to React implementation.

## Preconditions

Before starting this checklist, use these documents as the source of truth:

- `domhub-final-product-plan.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-figma-component-library-structure.md`
- `domhub-react-figma-component-map.md`
- `domhub-access-platform-final-plan.md`

Use the frontend semantic token bridge as the code-side visual reference:

- `frontend/src/styles/ds-tokens.css`

## Scope Rule

During this 7-day transition:

- do not design every screen in the product;
- do not build a giant component library before the first real screens exist;
- do not optimize for dark mode, advanced animation, or edge modules first;
- do not replace the existing product specification with ad hoc design decisions.

The scope is intentionally limited to the visual foundation and the first critical DomHub role flows.

## Day 1 - Create The Figma Source Of Truth

### Goal

Create one clean Figma file structure and lock the initial visual direction.

### Tasks

- Create one main Figma file for DomHub product UI.
- Add pages:
  - `00 Foundations`
  - `01 Resident`
  - `02 Security`
  - `03 Concierge & Staff`
  - `04 Technician & Contractor`
  - `05 Property Admin`
  - `06 Management Company`
  - `07 Platform Admin`
  - `08 Onboarding`
  - `09 Prototype Flows`
- Copy the naming conventions from `domhub-figma-component-library-structure.md`.
- Add a short cover frame describing:
  - product name;
  - visual direction;
  - role set;
  - primary source-of-truth docs.
- Choose and freeze the first visual direction:
  - premium residential;
  - quiet luxury operations;
  - operational clarity over decorative density.

### Output

- One Figma file with the correct page structure.
- A frozen first-pass visual direction.

### Done When

- The file no longer feels like an empty sandbox.
- Any contributor can see where foundations, roles, and flows belong.

## Day 2 - Port Foundations Into Figma

### Goal

Translate the DomHub token system into Figma foundations.

### Tasks

- Create color variables from `domhub-design-tokens-css-spec.md`.
- Add the primary type scale:
  - display
  - heading
  - body
  - label
  - metric
- Create spacing references from the shared spacing scale.
- Create radius, shadow, and border foundation notes.
- Create semantic token groups:
  - surface
  - text
  - border
  - success
  - warning
  - danger
  - info
- Add density guidance notes for:
  - resident
  - concierge/staff
  - security
  - property admin
  - management company

### Output

- Figma variables and styles for the first visual system pass.

### Done When

- The main tokens in `domhub-design-tokens-css-spec.md` are visible and reusable in Figma.
- Designers and developers can point to the same semantic language.

## Day 3 - Build First Shared Components

### Goal

Create only the reusable components needed to build the first critical screens.

### Tasks

- Build first-wave components:
  - `Button`
  - `Icon Button`
  - `Input`
  - `Search Input`
  - `Select`
  - `Card`
  - `Panel`
  - `Status Pill`
  - `Badge`
  - `Metric Card`
  - `Top Bar`
  - `Sidebar`
  - `Bottom Nav`
  - `Alert Banner`
- Add the first role-aware layout shells:
  - mobile resident shell;
  - desktop operations shell;
  - desktop dashboard shell.
- Use the naming and hierarchy from `domhub-figma-component-library-structure.md`.
- Match component intent to `domhub-react-figma-component-map.md`.

### Output

- First working component layer in Figma.

### Done When

- The next screen work can be assembled from components instead of frame-by-frame redraws.

## Day 4 - Build Resident Screens

### Goal

Finish the first premium resident-facing screens in high fidelity.

### Tasks

- Build `Resident / Home`.
- Build `Resident / Guest Pass / Form`.
- Build `Resident / Guest Pass / Success`.
- Build `Resident / Vehicle Pass / Form`.
- Build `Resident / Vehicle Pass / Success`.
- Confirm that resident UI feels:
  - premium;
  - calm;
  - simple;
  - mobile-first.
- Use the wireframe logic already defined in the product planning conversations:
  - quick actions;
  - active items;
  - important updates;
  - recent activity.

### Output

- A resident experience that is strong enough to represent the product externally.

### Done When

- A user can understand the resident value proposition from the Figma file alone.
- The visual language feels like premium residential service, not a generic utility app.

## Day 5 - Build Security And Staff Screens

### Goal

Design the first real operational interfaces.

### Tasks

- Build `Security / Workspace / Default`.
- Build `Security / Workspace / QR Result / Allowed`.
- Build `Security / Workspace / QR Result / Denied`.
- Build `Staff / Request Queue`.
- Create the first versions of:
  - `Queue Row`
  - `Pass Row`
  - `Vehicle Row`
  - `Scan Result Panel`
  - `Allow / Deny Block`
  - `Detail Side Panel`
- Confirm that security is:
  - high-clarity;
  - action-first;
  - not visually noisy.
- Confirm that staff UI is:
  - dense but readable;
  - filterable;
  - queue-first.

### Output

- The first serious operational UI for DomHub.

### Done When

- The product no longer looks like only a resident app.
- The system visibly supports real staff workflows.

## Day 6 - Build Admin And Portfolio Views

### Goal

Make the control layer real.

### Tasks

- Build `Property Admin / Dashboard`.
- Build `Company Admin / Portfolio Dashboard`.
- Add the minimum dashboard-specific components:
  - `KPI Strip`
  - `Problem List`
  - `Comparison Table`
  - `Trend Chart Container`
  - `Incident Card`
  - `Policy Card`
- Confirm the difference between the two dashboards:
  - property admin = one-object control room;
  - management company = portfolio oversight.

### Output

- DomHub now visibly supports both object-level and company-level operations.

### Done When

- The file clearly expresses the multi-tenant and portfolio nature of the platform.

## Day 7 - Cleanup, Prototype Flows, And Handoff

### Goal

Turn the file from a set of screens into a usable implementation source.

### Tasks

- Clean all inconsistent spacing, naming, and token usage.
- Move repeated UI into shared components.
- Link the first prototype flows:
  - resident guest pass flow;
  - security allow/deny flow;
  - staff request handling flow.
- Add annotations on the first critical screens:
  - intended role;
  - screen purpose;
  - linked React/component target;
  - linked product docs.
- Verify the screen-to-code mapping against `domhub-react-figma-component-map.md`.
- Write a short handoff note inside the Figma file:
  - what is final enough to implement;
  - what is still exploratory;
  - what remains out of scope.

### Output

- A Figma file ready for first-pass implementation work.

### Done When

- The first implementation wave can start without rethinking every screen from scratch.

## Critical Screen Set

By the end of the week, these screens must exist in Figma:

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
- `Company Admin / Portfolio Dashboard`

## Critical Component Set

By the end of the week, these components must exist in Figma:

- `Button`
- `Input`
- `Search Input`
- `Select`
- `Card`
- `Panel`
- `Status Pill`
- `Metric Card`
- `Top Bar`
- `Sidebar`
- `Bottom Nav`
- `Queue Row`
- `Pass Row`
- `Vehicle Row`
- `Detail Side Panel`
- `Alert Banner`
- `Scan Result Panel`
- `Allow / Deny Block`

## Weekly Review Questions

At the end of Day 7, verify:

- Does DomHub feel premium or still generic?
- Do the five roles feel distinct but systemically related?
- Can the first screens be implemented from Figma without inventing the product again?
- Are tokens and components reused consistently?
- Does the security workspace feel operationally credible?
- Does the resident UI feel like premium service software rather than ЖКХ utility tooling?
- Does the property dashboard feel like a control room?
- Does the management company dashboard feel like portfolio oversight rather than a duplicate of the property dashboard?

## Exit Criteria

This transition is complete only when:

- Figma is now the visual source of truth;
- Claude remains the UX and critique copilot, not the only design workspace;
- the first DomHub role screens are stable enough for frontend implementation;
- the file structure can scale beyond the first week without collapsing into chaos.
