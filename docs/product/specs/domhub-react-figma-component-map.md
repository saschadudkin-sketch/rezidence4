# DomHub React And Figma Component Map

This document maps the first critical DomHub screens to:

- existing React design-system components in `frontend/src/design-system`
- proposed React components to add next
- matching Figma component patterns

## Purpose

- make the first implementation slices concrete
- connect Figma patterns to React work
- avoid one-off UI per role

## Current React Components Available

From `frontend/src/design-system`:

- `Button`
- `Card`
- `Badge`
- `Input`
- `Avatar`
- `StatusPill`
- `Spinner`
- `EmptyState`

## Next React Components To Build

These are the next required pieces for the first four role-critical screens:

- `TopBar`
- `Sidebar`
- `BottomNav`
- `MetricCard`
- `QuickActionCard`
- `QueueRow`
- `PassCard`
- `VehicleRow`
- `DetailSidePanel`
- `AlertBanner`
- `SearchInput`
- `FilterBar`
- `ScanResultPanel`
- `AllowDenyBlock`
- `IncidentCard`
- `ResidentQuickViewCard`
- `RequestDetailPanel`

## Figma Source Pages

Use the Figma structure from:

- `domhub-figma-component-library-structure.md`

Key Figma pages:

- `03 Navigation`
- `04 Inputs`
- `05 Buttons`
- `06 Feedback`
- `07 Data Display`
- `09 Resident Patterns`
- `10 Security Patterns`
- `11 Staff Patterns`
- `13 Admin Patterns`

---

## Screen 1: Resident Home

### Screen Intent

- premium resident self-service home
- three primary actions
- active passes, requests, and urgent updates

### React Composition

**Can use now**

- `Button`
- `Card`
- `StatusPill`
- `Badge`
- `Avatar`
- `EmptyState`

**Build next**

- `TopBar`
- `BottomNav`
- `QuickActionCard`
- `PassCard`
- `RequestCard`
- `AnnouncementCard`
- `ActivityList`

### Suggested React Tree

```text
ResidentHomePage
  TopBar
  WelcomePanel
  QuickActionsGrid
    QuickActionCard x3
  ActiveItemsSection
    PassCard
    RequestCard
  ImportantUpdatesSection
    AnnouncementCard
  RecentActivitySection
    ActivityList
  BottomNav
```

### Figma Mapping

- `Navigation / Top Bar / Resident`
- `Navigation / Bottom Nav / Resident`
- `Resident / Quick Action Card`
- `Resident / Pass Card / Active`
- `Resident / Request Card / In Progress`
- `Feedback / Alert Banner / Info`

### Token Emphasis

- `--density-resident-card-padding`
- `--density-resident-grid-gap`
- `--button-primary-bg`
- `--card-bg-default`

---

## Screen 2: Security Workspace

### Screen Intent

- real-time operational console for guards
- search, scan, decision, and event review

### React Composition

**Can use now**

- `Button`
- `Card`
- `Input`
- `StatusPill`
- `Badge`

**Build next**

- `TopBar`
- `SearchInput`
- `PassRow`
- `VehicleRow`
- `ScanResultPanel`
- `AllowDenyBlock`
- `AccessEventTimeline`
- `BlacklistAlert`
- `IncidentCard`
- `DetailSidePanel`

### Suggested React Tree

```text
SecurityWorkspacePage
  TopBar
  SearchToolbar
    SearchInput
    Button(Scan QR)
  SecurityWorkspaceGrid
    ExpectedGuestsPanel
      PassRow[]
    DecisionPanel
      ScanResultPanel
      AllowDenyBlock
    RecentEventsPanel
      AccessEventTimeline
    DetailSidePanel
      GuestOrVehicleDetails
    AlertsPanel
      BlacklistAlert[]
      IncidentCard[]
```

### Figma Mapping

- `Navigation / Top Bar / Security`
- `Security / Scan Result / Allowed`
- `Security / Scan Result / Denied`
- `Security / Allow Deny Block`
- `Security / Access Event Row`
- `Security / Blacklist Alert`
- `Data Display / Detail Side Panel`

### Token Emphasis

- `--density-security-row-height`
- `--density-security-action-height`
- `--security-console-bg`
- `--security-decision-allow-bg`
- `--security-decision-deny-bg`

---

## Screen 3: Staff Request Queue

### Screen Intent

- concierge/property-admin queue-first operations
- triage, assign, and inspect requests quickly

### React Composition

**Can use now**

- `Button`
- `Card`
- `Input`
- `StatusPill`
- `Badge`
- `Avatar`

**Build next**

- `Sidebar`
- `SearchInput`
- `FilterBar`
- `MetricCard`
- `QueueRow`
- `DetailSidePanel`
- `RequestDetailPanel`
- `SLAIndicator`
- `InternalNotesThread`

### Suggested React Tree

```text
StaffQueuePage
  Sidebar
  PageTopBar
    SearchInput
    FilterBar
  KPIStrip
    MetricCard[]
  QueueLayout
    QueueList
      QueueRow[]
    DetailSidePanel
      RequestDetailPanel
      InternalNotesThread
      ActionButtons
```

### Figma Mapping

- `Navigation / Sidebar / Staff`
- `Inputs / Search Input`
- `Navigation / Filter Bar`
- `Data Display / Metric Card`
- `Staff / Queue Row`
- `Staff / Request Detail Layout`
- `Staff / SLA Indicator`

### Token Emphasis

- `--density-staff-row-height`
- `--density-staff-panel-padding`
- `--density-staff-grid-gap`
- `--dashboard-metric-bg`

---

## Screen 4: Property Admin Dashboard

### Screen Intent

- control room for one property
- combine KPI visibility and operational control points

### React Composition

**Can use now**

- `Button`
- `Card`
- `Badge`
- `StatusPill`

**Build next**

- `Sidebar`
- `TopBar`
- `MetricCard`
- `DashboardPanel`
- `ProblemList`
- `RecentActivityFeed`
- `HealthWidget`
- `ChartContainer`
- `ContractorSummaryCard`

### Suggested React Tree

```text
PropertyAdminDashboardPage
  Sidebar
  TopBar
  KPIStrip
    MetricCard[]
  DashboardGrid
    ProblemRequestsPanel
    AccessIncidentsPanel
    ContractorSummaryPanel
    StaffLoadPanel
    NotificationHealthPanel
    RecentAdminActionsPanel
  AnalyticsRow
    ChartContainer[]
```

### Figma Mapping

- `Navigation / Sidebar / Admin`
- `Admin / Dashboard Grid`
- `Data Display / KPI Strip`
- `Data Display / Metric Card`
- `Admin / Policy Card`
- `Admin / Health Widget`
- `Company / Trend Chart Container`

### Token Emphasis

- `--density-admin-table-row-height`
- `--density-admin-panel-padding`
- `--density-admin-grid-gap`
- `--panel-bg-default`

---

## Cross-Screen Shared Components

### Highest Priority Shared Build Order

1. `TopBar`
2. `Sidebar`
3. `BottomNav`
4. `SearchInput`
5. `MetricCard`
6. `DetailSidePanel`
7. `AlertBanner`
8. `QueueRow`
9. `PassCard`
10. `ScanResultPanel`

### Why These First

- they unlock all four critical screens
- they reduce one-off layout code
- they create direct parity between Figma and React implementation

## Handoff Rule

For each new shared component:

- define the Figma source component name
- define the React component name
- define the token dependencies
- list the first screens that consume it

## Suggested Next Mapping Targets

After these four screens:

- `Management Company Dashboard`
- `Concierge Workspace`
- `Technician Task Detail`
- `Contractor Job Detail`
