# DomHub Figma Project Copy-Paste Outline

This document is a ready-to-paste outline for setting up the first DomHub Figma product file.

Use it when you want to create the initial file structure quickly without rethinking page order, frame naming, or first-wave screen scope.

Use this together with:

- `domhub-figma-file-template.md`
- `domhub-7-day-figma-transition-checklist.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`

## How To Use

Create one main Figma file and paste this outline into a planning note, cover frame, or project brief section inside the file.

Then create pages and frames in the same order.

## Product Header

```text
DomHub
Premium residential operations platform

Roles:
- Resident
- Concierge
- Security
- Property Admin
- Management Company Admin

Visual direction:
- Quiet luxury operations
- Premium residential service
- Operational clarity

First-wave goal:
- Establish one Figma source of truth
- Build foundations and first reusable components
- Design the first critical resident, security, staff, and admin screens
- Prepare first implementation-ready UI set
```

## Page Outline

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
11 Onboarding
12 Prototype Flows
```

## `00 Cover`

```text
File Cover
Product Positioning
Roles Overview
Current Visual Direction
Source Of Truth
Contribution Rules
```

## `01 Foundations`

```text
Foundations / Color
Foundations / Typography
Foundations / Spacing
Foundations / Radius
Foundations / Shadows
Foundations / Borders
Foundations / Motion
Foundations / Role Density
```

## `02 Components`

```text
Components / Actions
  Button / Primary / Default
  Button / Primary / Hover
  Button / Secondary / Default
  Button / Secondary / Hover
  Button / Danger / Default
  Icon Button / Default

Components / Inputs
  Input / Default
  Input / Focus
  Input / Error
  Search Input / Default
  Search Input / Active
  Select / Default
  Date Picker Trigger / Default
  Time Picker Trigger / Default
  Textarea / Default

Components / Navigation
  Top Bar / Resident
  Top Bar / Operations
  Sidebar / Default
  Sidebar Item / Default
  Sidebar Item / Active
  Bottom Nav / Resident
  Tab Bar / Default
  Filter Bar / Default

Components / Data Display
  Card / Default
  Panel / Default
  Metric Card / Default
  KPI Strip / Default
  Status Pill / Neutral
  Status Pill / Success
  Status Pill / Warning
  Status Pill / Danger
  Badge / Default
  Avatar / Default
  Data Row / Default
  Key Value Block / Default

Components / Feedback
  Alert Banner / Info
  Alert Banner / Warning
  Alert Banner / Danger
  Empty State / Default
  Toast / Default
  Skeleton / Card

Components / Domain
  Queue Row / Default
  Pass Row / Default
  Vehicle Row / Default
  Request Card / Default
  Incident Card / Default
  Resident Quick Card / Default
  Package Row / Default
  Contractor Job Card / Default
  Policy Card / Default
  Access Zone Card / Default
  Access Point Card / Default

Components / Security
  Scan Result Panel / Allowed
  Scan Result Panel / Denied
  Allow Deny Block / Default
  Manual Override Block / Default
  Blacklist Alert / Default
  Access Event Timeline / Default

Components / Layout
  Detail Side Panel / Default
  Split View / Default
  Sticky Action Bar / Default
  Drawer / Default
  Modal / Default
```

## `03 Patterns`

```text
Pattern / Mobile Resident Shell
Pattern / Desktop Operations Shell
Pattern / Dashboard Shell
Pattern / Queue With Detail Panel
Pattern / Search + Filters + KPI Strip
Pattern / Problem List
Pattern / Entity Header
Pattern / Summary + Activity Split
```

## `04 Resident`

```text
Resident / Home
Resident / Guest Pass / Form
Resident / Guest Pass / Success
Resident / Vehicle Pass / Form
Resident / Vehicle Pass / Success
Resident / Requests / Create
Resident / Requests / List
Resident / Request / Detail
Resident / Announcements
Resident / Documents
Resident / Profile
Resident / Notifications
```

## `05 Security`

```text
Security / Workspace / Default
Security / Workspace / QR Result / Allowed
Security / Workspace / QR Result / Denied
Security / Workspace / Vehicle Search
Security / Workspace / Manual Override
Security / Passes / List
Security / Vehicles / List
Security / Incidents / List
Security / Incidents / Detail
```

## `06 Concierge & Staff`

```text
Staff / Request Queue
Staff / Request Detail
Concierge / Workspace
Concierge / Packages
Concierge / Resident Quick View
Concierge / Guest Assistance
```

## `07 Technician & Contractor`

```text
Technician / Assigned Tasks
Technician / Task Detail
Technician / Resolution
Contractor / Assigned Jobs
Contractor / Job Detail
Contractor / Completion
```

## `08 Property Admin`

```text
Property Admin / Dashboard
Property Admin / Requests
Property Admin / Access Rules
Property Admin / Access Zones
Property Admin / Access Points
Property Admin / Contractors
Property Admin / Staff
Property Admin / Incidents
Property Admin / Notifications
Property Admin / Settings
```

## `09 Management Company`

```text
Company Admin / Portfolio Dashboard
Company Admin / Properties List
Company Admin / Property Comparison
Company Admin / Portfolio Incidents
Company Admin / Portfolio Analytics
Company Admin / Standards & Policies
Company Admin / Contractor Oversight
```

## `10 Platform Admin`

```text
Platform Admin / Registry
Platform Admin / Property Lifecycle
Platform Admin / Feature Flags
Platform Admin / Health Overview
Platform Admin / Integrations
```

## `11 Onboarding`

```text
Onboarding / Create Property
Onboarding / Import Structure
Onboarding / Import Residents
Onboarding / Import Staff
Onboarding / Launch Checklist
```

## `12 Prototype Flows`

```text
Flow / Resident Guest Pass
Flow / Resident Vehicle Pass
Flow / Security Allow Deny
Flow / Staff Request Handling
Flow / Contractor Access
Flow / Property Admin Daily Review
```

## First-Week Build Order

```text
Step 1
- 00 Cover
- 01 Foundations

Step 2
- 02 Components
  - Button
  - Input
  - Search Input
  - Card
  - Panel
  - Status Pill
  - Top Bar
  - Sidebar
  - Bottom Nav
  - Metric Card

Step 3
- 04 Resident
  - Resident / Home
  - Resident / Guest Pass / Form
  - Resident / Guest Pass / Success

Step 4
- 05 Security
  - Security / Workspace / Default
  - Security / Workspace / QR Result / Allowed
  - Security / Workspace / QR Result / Denied

Step 5
- 06 Concierge & Staff
  - Staff / Request Queue

Step 6
- 08 Property Admin
  - Property Admin / Dashboard

Step 7
- 09 Management Company
  - Company Admin / Portfolio Dashboard

Step 8
- 12 Prototype Flows
  - Flow / Resident Guest Pass
  - Flow / Security Allow Deny
  - Flow / Staff Request Handling
```

## Annotation Template

Copy this block next to each first-wave screen:

```text
Role:
Purpose:
Primary actions:
Main data shown:
Related React target:
Related spec:
Status:
```

## Status Labels

Copy this label set into the file:

```text
Exploration
Draft
Review
Approved For First Implementation
Deprecated
```

## Contribution Rules

Copy this into the cover or contribution area:

```text
Rules
- Foundations live in 01 Foundations
- Reusable UI lives in 02 Components
- Repeated layout structures live in 03 Patterns
- Role-specific screens stay in their role pages
- Do not duplicate reusable components in screen pages
- Do not mix exploratory frames with approved implementation screens
- Keep naming consistent with the product spec and component map
```

## Quick Sanity Check

The setup is correct when:

- one person can find any first-wave screen immediately;
- resident, security, staff, and admin work are clearly separated;
- the component page is small but usable;
- the file can scale without becoming a dumping ground.
