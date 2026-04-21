# DomHub Figma Component Library Structure

This document defines the recommended Figma library structure for DomHub.

## Purpose

- Keep one shared component system across all DomHub roles
- Separate foundations, shared components, and role-specific patterns
- Make handoff to frontend straightforward

## File Structure

Recommended split:

1. `DomHub Foundations`
2. `DomHub Core Components`
3. `DomHub Product Patterns`
4. `DomHub Screens`

If the team is small, this can live in one file with the page structure below.

---

## Recommended Figma Pages

### `00 Cover`

- library intro
- version
- ownership
- change log

### `01 Foundations`

- colors
- typography
- spacing
- radius
- shadows
- motion
- density modes
- iconography

### `02 Tokens Preview`

- palette preview
- semantic color usage
- text styles preview
- elevation preview
- layout spacing preview

### `03 Navigation`

- top bars
- sidebars
- bottom nav
- tabs
- breadcrumbs
- filter bars

### `04 Inputs`

- text input
- search input
- textarea
- select
- date picker
- time picker
- checkbox
- radio
- toggle
- field groups

### `05 Buttons`

- primary
- secondary
- ghost
- danger
- icon button
- button groups

### `06 Feedback`

- status pills
- badges
- alerts
- toasts
- banners
- empty states
- skeletons

### `07 Data Display`

- cards
- panels
- metric cards
- KPI strips
- key-value rows
- tables
- table toolbar
- list rows
- timelines

### `08 Overlays`

- modal
- drawer
- side panel
- action sheet
- confirmation dialog

### `09 Resident Patterns`

- quick actions
- pass card
- request card
- announcement card
- document row
- resident home sections

### `10 Security Patterns`

- scan result panel
- allow/deny block
- manual override block
- access event row
- incident summary card
- blacklist alert

### `11 Staff Patterns`

- queue row
- request detail layout
- internal notes thread
- resident quick view
- SLA indicator
- package handoff block

### `12 Technician And Contractor Patterns`

- task row
- job row
- resolution form blocks
- access window badge
- result upload block

### `13 Admin Patterns`

- dashboard grid
- policy card
- access zone card
- access point card
- contractor row
- staff row
- health widget

### `14 Company Patterns`

- portfolio summary block
- comparison table
- problem object list
- drill-down side panel
- trend/chart containers

### `15 Screen Compositions`

- resident home
- guest pass flow
- security workspace
- staff queue
- property admin dashboard
- management company dashboard

### `16 Prototype Flows`

- resident pass flow
- security allow/deny flow
- request handling flow
- contractor access flow
- portfolio review flow

---

## Naming Convention

Use this format:

`Category / Component / Variant / State`

Examples:

- `Button / Primary / Default`
- `Button / Primary / Hover`
- `Input / Search / Filled`
- `Status / Success / Default`
- `Card / Pass / Active`
- `Security / Scan Result / Allowed`
- `Admin / Metric Card / Warning`

For components with size variants:

`Category / Component / Size / Variant / State`

Examples:

- `Button / Primary / Md / Default`
- `Badge / Status / Sm / Success`

## Variant Axes

Recommended variant properties:

- `size`: `sm | md | lg`
- `state`: `default | hover | focus | disabled | selected`
- `tone`: `default | success | warning | danger | info`
- `density`: `resident | staff | security | admin | company`

Avoid using page names as variant properties.

---

## Component Hierarchy

### Level 1: Base Primitives

- button
- input
- badge
- card
- panel
- icon
- avatar
- divider

### Level 2: Shared Product Components

- filter bar
- table row
- metric card
- detail panel
- modal
- timeline row
- banner

### Level 3: Role-Specific Components

- pass card
- queue row
- scan result panel
- policy card
- package handoff block
- contractor job row
- portfolio summary block

### Level 4: Screen Sections

- resident quick actions section
- security live feed section
- staff queue section
- admin dashboard section
- company portfolio section

---

## Publish Strategy

Publish only:

- foundations
- base primitives
- shared product components
- stable role-specific patterns

Do not publish early:

- unfinished screen compositions
- exploratory layouts
- one-off marketing experiments

## Suggested Ownership

- Foundations: design lead
- Core components: product designer + frontend lead
- Role-specific patterns: product designer for each workflow area
- Screen compositions: product team

## Handoff Notes

Every published component should include:

- intended usage
- responsive behavior
- variant rules
- token references
- implementation notes for frontend

## First Components To Build

Build in this order:

1. `Button`
2. `Input`
3. `Search Input`
4. `Card`
5. `Panel`
6. `Status Pill`
7. `Sidebar`
8. `Top Bar`
9. `Metric Card`
10. `Queue Row`
11. `Detail Side Panel`
12. `Pass Card`
13. `Scan Result Panel`
14. `Table`
15. `Policy Card`

## First Screens To Assemble

1. `Resident / Home`
2. `Resident / Guest Pass / Form`
3. `Security / Workspace / Default`
4. `Security / Workspace / QR Result / Allowed`
5. `Staff / Request Queue`
6. `Property Admin / Dashboard`
7. `Company Admin / Portfolio Dashboard`
