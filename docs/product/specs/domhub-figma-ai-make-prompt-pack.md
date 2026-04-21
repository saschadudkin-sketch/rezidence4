# DomHub Figma AI / Make Prompt Pack

This document provides ready-to-use prompts for Figma AI and Figma Make to help generate the first DomHub visual system and critical screens.

Use this after:

- the visual direction is clear;
- the first product roles are fixed;
- the file structure is defined;
- the scope of the first screens is already decided.

Use this together with:

- `domhub-figma-file-template.md`
- `domhub-figma-project-copy-paste-outline.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`
- `domhub-7-day-figma-transition-checklist.md`

## Working Context

Use this framing consistently in Figma AI / Make:

- product: `DomHub`
- category: premium residential operations platform
- core promise: access, operations, staff workflows, and portfolio oversight in one system
- roles:
  - resident
  - concierge
  - security
  - property admin
  - management company admin
- visual direction:
  - quiet luxury operations
  - premium residential service
  - operational clarity

## General Prompt Rule

Figma AI and Figma Make work better when prompts specify:

- role;
- screen purpose;
- layout type;
- content blocks;
- visual tone;
- what to avoid.

Do not ask them to generate the whole platform in one prompt.

## Foundations Prompts

### Prompt F1 - Visual Foundation Direction

```text
Create a visual foundation for DomHub, a premium residential operations platform.

The design should feel calm, premium, trustworthy, and operationally precise.

Roles supported by the system:
- resident
- concierge
- security
- property admin
- management company admin

Visual direction:
- quiet luxury operations
- premium residential service
- structured clarity

Avoid:
- generic SaaS gradients
- purple-heavy palettes
- glossy luxury cliches
- cluttered dashboards

Generate:
- palette direction
- typography direction
- spacing and surface guidance
- examples of how the system adapts from mobile resident UX to dense desktop operations UI
```

### Prompt F2 - Component Foundations

```text
Generate the first UI component direction for DomHub.

I need a premium system that supports both mobile and desktop.

Prioritize:
- buttons
- inputs
- cards
- panels
- status pills
- top bars
- sidebars
- metric cards

The system should feel consistent across resident, security, staff, and admin experiences while preserving different density levels per role.
```

## Resident Prompts

### Prompt R1 - Resident Home

```text
Create a premium mobile home screen for DomHub resident users.

Main goals:
- create guest pass
- create vehicle pass
- create service request
- see active passes
- see current requests
- read important building updates

The screen should feel like a concierge-level residential service app.
It should be calm, elegant, and very easy to understand.

Avoid utility-app clutter.
```

### Prompt R2 - Guest Pass Form

```text
Create a premium mobile guest pass creation screen for DomHub.

Fields should include:
- guest name
- phone
- date
- time window
- one-time or multi-use option
- optional note

Also include a clean summary preview area and a strong primary action.

The screen should feel fast, elegant, and trustworthy.
```

### Prompt R3 - Guest Pass Success

```text
Create a premium mobile success state for a DomHub guest pass.

Include:
- clear confirmation
- QR presentation area
- pass validity information
- actions to share and open the QR

The screen should feel polished and calm, not celebratory in a consumer-app way.
```

### Prompt R4 - Vehicle Pass Flow

```text
Create a premium mobile vehicle pass flow for DomHub.

The screen should align with the guest pass flow, but support vehicle-specific information and a clear validity window.

Keep the design minimal, elegant, and operationally clear.
```

## Security Prompts

### Prompt S1 - Security Workspace

```text
Create a desktop security workspace for DomHub, designed for guards at a residential checkpoint.

Primary tasks:
- search by guest, apartment, vehicle, or pass
- scan QR
- allow
- deny
- manual override
- see recent access events
- identify suspicious or blacklisted entries

The layout should include:
- top search and scan zone
- strong central decision area
- expected visitors and vehicles
- recent events
- a detail panel

The UI must feel fast, high-clarity, and operationally credible.
Avoid decorative excess.
```

### Prompt S2 - Allowed Result State

```text
Create a DomHub security result state for access allowed.

Show:
- person or vehicle identity
- apartment or inviter
- validity window
- pass type
- a strong allow action
- secondary actions if needed

The screen should feel confident, immediate, and easy to act on.
```

### Prompt S3 - Denied Result State

```text
Create a DomHub security result state for access denied.

Show:
- denial reason
- key entity details
- incident-ready actions
- manual override option

The screen should feel controlled, clear, and serious.
It should support fast decision-making under pressure.
```

## Staff / Concierge Prompts

### Prompt C1 - Staff Request Queue

```text
Create a desktop request queue for DomHub staff and concierge users.

The interface should support:
- search
- filters
- KPI strip
- request list
- detail side panel
- assignment and status actions
- SLA visibility

The UI should be dense but clean, with excellent hierarchy and scanability.
This is an operations interface, not a generic admin dashboard.
```

### Prompt C2 - Concierge Workspace

```text
Create a DomHub concierge workspace for premium residential front-desk operations.

The interface should help:
- manage incoming requests
- assist residents
- manage packages
- help with guest access
- quickly look up apartments and residents

The UI should feel warm, professional, and service-oriented while remaining operationally efficient.
```

## Admin Prompts

### Prompt A1 - Property Admin Dashboard

```text
Create a desktop property admin dashboard for DomHub.

This is the control room for one premium residential property.

The dashboard should include:
- KPI strip
- request health
- access incidents
- staff and contractor activity
- notification health
- recent admin actions

The design should feel elegant, data-rich, and serious without becoming noisy or overcrowded.
```

### Prompt A2 - Management Company Dashboard

```text
Create a desktop management company dashboard for DomHub.

This dashboard oversees multiple residential properties.

It should support:
- portfolio KPI comparison
- property list
- problem property identification
- incident overview
- portfolio trends

The layout should feel executive and analytical.
Do not make it look like a copy of a single-property dashboard.
```

### Prompt A3 - Dashboard Differentiation

```text
Generate two clearly differentiated dashboard concepts for DomHub:

1. Property Admin Dashboard
2. Management Company Portfolio Dashboard

Explain the difference in:
- purpose
- hierarchy
- data density
- decision patterns
- layout composition

Both should remain visually connected within one design system.
```

## Flow And Prototype Prompts

### Prompt P1 - Resident Flow

```text
Create a linked prototype flow for DomHub resident guest pass creation:
- resident home
- create guest pass form
- review or summary
- success state

Keep the flow calm, premium, and highly understandable.
```

### Prompt P2 - Security Flow

```text
Create a linked prototype flow for DomHub security operations:
- security workspace
- QR result allowed
- QR result denied

The flow should feel operational, fast, and high confidence.
```

### Prompt P3 - Staff Flow

```text
Create a linked prototype flow for DomHub staff request handling:
- request queue
- request detail
- assignment or status update

The design should support dense information and quick operational decisions.
```

## Figma Make Prompts

Use these when you want a more assembled screen or prototype, not just component suggestions.

### Prompt M1 - Resident Home In Make

```text
Build a polished mobile screen for DomHub resident home.

Use a premium residential style with calm neutrals, elegant typography, generous spacing, and a strong but restrained primary color.

Must include:
- welcome block
- quick actions for guest pass, vehicle pass, and service request
- active passes section
- active requests section
- important building updates

Avoid generic cards and avoid purple SaaS styling.
```

### Prompt M2 - Security Console In Make

```text
Build a polished desktop security console for DomHub.

This should feel like a real checkpoint tool, not a generic dashboard.

Include:
- search bar
- scan QR action
- central allow or deny panel
- expected guests
- expected vehicles
- recent events
- detail side panel

Make it premium, restrained, and operationally strong.
```

### Prompt M3 - Property Dashboard In Make

```text
Build a polished desktop property admin dashboard for DomHub.

Include:
- KPI strip
- request health panel
- access incident panel
- contractor activity
- notification health
- recent admin actions

Make it feel like the control room for a premium property.
Use hierarchy and composition, not excessive decoration.
```

## Review Prompts For Figma AI / Make Output

### Prompt V1 - Premium Check

```text
Review this DomHub screen and tell me whether it feels premium or generic.

Judge:
- hierarchy
- typography
- spacing
- color restraint
- trust
- product maturity

Then propose exact changes.
```

### Prompt V2 - Role Credibility Check

```text
Review this DomHub screen and tell me whether it fits the intended role:
- resident
- concierge
- security
- property admin
- management company admin

Call out any UI that belongs to a different role or breaks role clarity.
```

### Prompt V3 - Buildability Check

```text
Review this DomHub Figma concept for implementation readiness.

Tell me:
- what should become shared components
- what is screen-specific
- what is still ambiguous
- what needs annotation before implementation
```

## Recommended Prompt Sequence

### First pass

- `Prompt F1`
- `Prompt F2`
- `Prompt R1`
- `Prompt S1`
- `Prompt C1`
- `Prompt A1`
- `Prompt A2`

### Second pass

- `Prompt R2`
- `Prompt R3`
- `Prompt R4`
- `Prompt S2`
- `Prompt S3`
- `Prompt C2`
- `Prompt A3`

### Third pass

- `Prompt P1`
- `Prompt P2`
- `Prompt P3`
- `Prompt V1`
- `Prompt V2`
- `Prompt V3`

## Scope Control Rules

- Generate one role or one flow at a time.
- Do not ask Figma AI or Make to generate the entire DomHub platform in one pass.
- Keep resident, security, staff, and admin prompts separate.
- Review output before moving it into the main source-of-truth pages.
- Prefer refinement over repeated full regeneration once the first direction is stable.

## Exit Criteria

This prompt pack is being used correctly when:

- the first DomHub screens are generated with strong role separation;
- the visual system remains calm, premium, and non-generic;
- Figma AI and Make output still aligns with the product specs and token logic;
- the generated screens can move into implementation planning without redesigning them from scratch.
