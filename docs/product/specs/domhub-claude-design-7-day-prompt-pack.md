# DomHub Claude Design 7-Day Prompt Pack

This document provides a ready-to-use prompt pack for the first 7 days of DomHub design work in Claude Design.

It is intended to work with:

- `domhub-7-day-figma-transition-checklist.md`
- `domhub-figma-file-template.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`

Use these prompts to:

- shape the visual direction;
- design the first critical screens;
- critique the work;
- keep the design system aligned with product intent.

## Working Rule

When using these prompts, keep the same product framing:

- product: `DomHub`
- category: premium residential operations platform
- primary roles:
  - resident
  - concierge
  - security
  - property admin
  - management company admin
- tone:
  - premium
  - calm
  - operationally credible
  - not generic SaaS

## Day 1 - Visual Direction

### Prompt 1A - Main Direction

```text
Create a visual direction for DomHub, a premium residential operations platform for apartment complexes and cottage communities.

DomHub supports five roles:
- resident
- concierge
- security
- property admin
- management company admin

The product should feel premium, calm, trustworthy, and operationally precise.
Avoid generic SaaS aesthetics, purple gradients, noisy dashboards, and glossy luxury cliches.

Visual direction keywords:
- quiet luxury operations
- premium residential service
- operational clarity
- elegant, warm, structured

Output:
1. visual direction summary
2. palette direction
3. typography direction
4. layout and spacing principles
5. how each role should feel visually distinct but systemically related
```

### Prompt 1B - Direction Comparison

```text
Generate three distinct visual directions for DomHub.

Direction A should emphasize premium residential calm.
Direction B should emphasize security and operational confidence.
Direction C should emphasize executive portfolio oversight.

For each direction, explain:
- emotional tone
- color character
- typography character
- where it works well
- where it risks becoming generic or mismatched

Then recommend the strongest direction for a premium multi-role proptech platform.
```

### Prompt 1C - Anti-Generic Review

```text
Review the chosen DomHub visual direction and tell me whether it still risks feeling like generic SaaS.

Evaluate:
- brand distinctiveness
- premium feeling
- proptech relevance
- multi-role flexibility
- long-term scalability into a design system

Then give concrete changes that would make it more ownable and less generic.
```

## Day 2 - UX Structure And Screen Logic

### Prompt 2A - Role-Based Navigation

```text
Design the navigation logic for DomHub across five roles:
- resident
- concierge
- security
- property admin
- management company admin

For each role, define:
- main navigation sections
- home screen purpose
- top three daily actions
- information density level

Make the result appropriate for a premium residential operations platform.
```

### Prompt 2B - Critical Screen Map

```text
Create the first-wave screen map for DomHub.

Prioritize only the most important screens for:
- resident access
- guest pass flow
- vehicle pass flow
- security checkpoint operations
- staff request handling
- property admin control room
- management company portfolio view

Do not generate every possible screen.
Create a focused first-wave list that is realistic for the first design and implementation cycle.
```

### Prompt 2C - First-Week Cut Line

```text
Given DomHub as a premium multi-role platform, define which screens must be included in the first week of design work and which should explicitly stay out of scope.

I want a practical cut line for:
- must design now
- can wait until week two or later
- should not be designed before the core flows are stable
```

## Day 3 - Foundations And Components

### Prompt 3A - Token Translation Support

```text
Help translate this DomHub visual direction into a practical UI foundation for Figma and frontend implementation.

I need:
- semantic color groups
- type scale recommendations
- spacing rhythm
- corner radius strategy
- shadow strategy
- density modes for resident, security, staff, and admin interfaces

The system must support both premium mobile UX and dense desktop operational screens.
```

### Prompt 3B - First Component Set

```text
Define the first reusable component set for DomHub.

I only want the components required to build the first critical screens.

Prioritize:
- buttons
- inputs
- search
- cards
- panels
- navigation
- metric cards
- queue rows
- status and alert components
- security decision components

For each component, tell me:
- purpose
- where it is used
- what variants are needed now
- what should wait until later
```

### Prompt 3C - Component System Critique

```text
Review this first-wave DomHub component set as if you were preparing it for a premium multi-role design system.

Tell me:
- what is missing
- what is duplicated
- what is overbuilt too early
- what should be shared across roles
- what should remain role-specific
```

## Day 4 - Resident Experience

### Prompt 4A - Resident Home

```text
Design the DomHub resident home screen for a premium residential property.

Primary actions:
- create guest pass
- create vehicle pass
- create service request

Content blocks:
- active passes
- active requests
- important updates
- recent activity

The screen must feel calm, premium, and mobile-first.
It should feel like concierge-level residential service software, not a ЖКХ utility app.
```

### Prompt 4B - Guest Pass Flow

```text
Design the DomHub resident guest pass flow.

I need:
- form screen
- confirmation summary
- success state

The flow should be fast, elegant, and easy to understand.
Minimize friction, avoid unnecessary fields, and make the success state feel polished and trustworthy.
```

### Prompt 4C - Vehicle Pass Flow

```text
Design the DomHub resident vehicle pass flow.

The flow should feel aligned with the guest pass flow but adapted for vehicle-specific information.

Focus on:
- clarity
- simple form structure
- premium visual treatment
- easy understanding of access duration and status
```

### Prompt 4D - Resident Experience Critique

```text
Critique the DomHub resident screens.

Evaluate:
- premium quality
- clarity of quick actions
- hierarchy
- trust
- calmness
- whether the product feels like a service layer for a premium building

Then propose exact UX and visual improvements.
```

## Day 5 - Security And Staff

### Prompt 5A - Security Workspace

```text
Design the DomHub security workspace for a residential checkpoint.

Primary tasks:
- scan QR
- search by guest, apartment, vehicle, or pass
- allow
- deny
- manual override
- review recent events
- identify suspicious or blacklisted entries

The interface must be fast, high-clarity, and operationally credible.
It should feel premium but highly practical.
```

### Prompt 5B - QR Result States

```text
Design two DomHub security result states:
- access allowed
- access denied

For both states, define:
- information hierarchy
- action placement
- visual tone
- what details the guard must see immediately

Make the allowed state feel confident and fast.
Make the denied state feel clear, controlled, and incident-ready.
```

### Prompt 5C - Staff Request Queue

```text
Design the DomHub staff request queue for concierge and operational staff.

The interface should support:
- search
- filters
- request list
- request detail side panel
- assignment and status actions
- SLA awareness

It should be dense but clean, with strong hierarchy and low cognitive friction.
```

### Prompt 5D - Operations Credibility Review

```text
Review the DomHub security and staff screens and tell me whether they feel operationally credible.

Evaluate:
- action speed
- clarity under pressure
- information density
- scanability
- decision confidence
- whether the UI would work in a real property operations context

Then propose concrete fixes.
```

## Day 6 - Admin And Portfolio

### Prompt 6A - Property Admin Dashboard

```text
Design the DomHub property admin dashboard for a premium residential building.

The dashboard should help manage:
- requests
- access incidents
- contractors
- staff activity
- notification health
- property-level KPIs

It should feel like a control room for one property: elegant, serious, and data-rich without becoming chaotic.
```

### Prompt 6B - Management Company Dashboard

```text
Design the DomHub management company portfolio dashboard for overseeing multiple residential properties.

The dashboard should support:
- property comparison
- portfolio KPIs
- problem building identification
- incident review
- contractor and operations oversight

It should feel executive, analytical, and premium.
Do not make it a duplicate of the property admin dashboard.
```

### Prompt 6C - Dashboard Separation Review

```text
Compare the DomHub property admin dashboard and management company dashboard.

Explain whether they are sufficiently different in:
- role purpose
- data hierarchy
- decision type
- information density
- visual structure

If they are too similar, rewrite the dashboard strategy for both.
```

## Day 7 - Cleanup, Consistency, And Handoff

### Prompt 7A - Multi-Role Consistency Review

```text
Review the first-wave DomHub screens together:
- resident home
- guest pass flow
- vehicle pass flow
- security workspace
- staff request queue
- property admin dashboard
- management company dashboard

Tell me whether they feel like one coherent product system.

Evaluate:
- visual consistency
- role differentiation
- token consistency
- component reuse
- premium feeling
- product maturity

Then propose a final cleanup pass.
```

### Prompt 7B - Handoff Readiness Review

```text
Review these DomHub first-wave screens for frontend handoff readiness.

I want to know:
- which screens are ready to implement now
- which screens still have unresolved design ambiguity
- which repeated patterns should become shared components
- which details need annotation before implementation

Be strict and practical.
```

### Prompt 7C - Final Anti-Bloat Review

```text
Review the first-wave DomHub design set and identify any early design bloat.

Call out:
- screens that are too complex
- components built too early
- visual treatments that are too decorative
- places where the product risks losing premium clarity

Then give a tighter first implementation cut.
```

## Fast Reusable Utility Prompts

Use these anytime during the week.

### Utility Prompt - Premium Check

```text
Does this DomHub screen feel premium or generic?
Explain why in concrete UI terms and propose exact fixes.
```

### Utility Prompt - Role Check

```text
Does this DomHub screen clearly reflect the needs of the intended role?
If not, explain what belongs to another role and how to correct it.
```

### Utility Prompt - Density Check

```text
Is the information density on this DomHub screen correct for its role?
Judge it for resident, security, staff, or admin usage and suggest corrections.
```

### Utility Prompt - Component Extraction

```text
Look at this DomHub screen and tell me which parts should become reusable components and which should remain screen-specific.
```

### Utility Prompt - Simplification Pass

```text
Simplify this DomHub screen without making it generic.
Preserve premium quality, but reduce clutter and improve hierarchy.
```

## Recommended Weekly Use

### Day 1

Use:

- `Prompt 1A`
- `Prompt 1B`
- `Prompt 1C`

### Day 2

Use:

- `Prompt 2A`
- `Prompt 2B`
- `Prompt 2C`

### Day 3

Use:

- `Prompt 3A`
- `Prompt 3B`
- `Prompt 3C`

### Day 4

Use:

- `Prompt 4A`
- `Prompt 4B`
- `Prompt 4C`
- `Prompt 4D`

### Day 5

Use:

- `Prompt 5A`
- `Prompt 5B`
- `Prompt 5C`
- `Prompt 5D`

### Day 6

Use:

- `Prompt 6A`
- `Prompt 6B`
- `Prompt 6C`

### Day 7

Use:

- `Prompt 7A`
- `Prompt 7B`
- `Prompt 7C`

## Exit Criteria

This prompt pack has been used correctly when:

- the first wave of DomHub design work follows one stable visual direction;
- role-specific screens are meaningfully differentiated;
- the first components and screens are coherent enough to move into Figma;
- the resulting design set is ready for frontend implementation planning.
