# DomHub Unified Design Workflow Pack

This document defines the recommended end-to-end design workflow for DomHub across:

- Claude Design
- Figma AI
- Figma Make
- Claude Code

The goal is to keep one coherent workflow from product thinking to visual system to implementation.

## Workflow Principle

Each tool has a different job.

Do not try to use one tool for everything.

### Claude Design

Use for:

- visual direction exploration;
- role-based UX structure;
- screen logic;
- critique;
- simplification;
- premium-quality review;
- deciding what belongs in the first wave.

Claude Design is the best tool for shaping and pressure-testing the product experience.

### Figma AI

Use for:

- visual foundations;
- design system thinking;
- component direction;
- screen generation in a Figma-native workflow;
- refining first-wave role screens;
- keeping the visual source of truth in one place.

Figma AI is the best tool for turning product and UX decisions into an organized visual system.

### Figma Make

Use for:

- assembled screen concepts;
- fast high-fidelity screen generation;
- quick layout exploration;
- prototype-style UI building;
- screen-to-screen flow assembly.

Figma Make is the best tool for quickly materializing real-looking screens once structure is already clear.

### Claude Code

Use for:

- production implementation;
- token bridge alignment;
- React component composition;
- frontend structure;
- design-to-code mapping;
- implementation review against specs.

Claude Code is the implementation engine, not the place to invent visual direction from scratch.

## Tool Sequence

The correct sequence is:

1. Claude Design
2. Figma AI
3. Figma Make
4. Claude Code

If needed, loop back:

- Claude Design for critique
- Figma AI for cleanup
- Claude Code for implementation refinement

## Phase 1 - Product And Visual Direction

### Tool

Claude Design

### Goal

Decide what DomHub should feel like before any serious Figma buildout starts.

### Inputs

- `domhub-final-product-plan.md`
- `domhub-access-platform-final-plan.md`
- role definitions from the product planning docs

### Outputs

- visual direction;
- screen priorities;
- role separation logic;
- first-wave design cut line.

### Questions To Resolve

- What makes DomHub premium?
- How different should resident and operations UIs feel?
- Which screens matter in week one?
- What should stay out of scope?

## Phase 2 - Foundations And Component System

### Tool

Figma AI

### Goal

Turn the chosen direction into an organized visual foundation.

### Inputs

- `domhub-design-tokens-css-spec.md`
- `domhub-figma-component-library-structure.md`
- `domhub-figma-file-template.md`

### Outputs

- page structure;
- foundational styles;
- first component set;
- layout patterns.

### Deliverables

- `00 Cover`
- `01 Foundations`
- `02 Components`
- `03 Patterns`

## Phase 3 - First-Wave Screens

### Tool

Figma AI and Figma Make

### Goal

Build the first screens that define the product.

### Inputs

- `domhub-7-day-figma-transition-checklist.md`
- `domhub-react-figma-component-map.md`
- `domhub-figma-ai-make-prompt-pack.md`

### Screens

- `Resident / Home`
- `Resident / Guest Pass / Form`
- `Resident / Guest Pass / Success`
- `Security / Workspace / Default`
- `Security / Workspace / QR Result / Allowed`
- `Security / Workspace / QR Result / Denied`
- `Staff / Request Queue`
- `Property Admin / Dashboard`
- `Company Admin / Portfolio Dashboard`

### Tool Split

Use Figma AI for:

- component-aware generation;
- aligning screens with the visual system;
- making screens feel part of one library.

Use Figma Make for:

- assembled polished screen drafts;
- fast layout iteration;
- quick prototype-style flows.

## Phase 4 - Critique And Cleanup

### Tool

Claude Design and Figma AI

### Goal

Remove genericness, UI noise, and role confusion before implementation starts.

### Review Dimensions

- premium quality;
- operational credibility;
- role separation;
- component reuse;
- density fit;
- buildability.

### Typical Loop

1. Generate or refine in Figma
2. Critique in Claude Design
3. Clean up in Figma
4. Freeze first implementation wave

## Phase 5 - Handoff Into Code

### Tool

Claude Code

### Goal

Implement the Figma-defined first-wave UI using the existing frontend architecture and token bridge.

### Inputs

- `frontend/src/styles/ds-tokens.css`
- `domhub-react-figma-component-map.md`
- approved first-wave Figma screens

### Build Order

1. shared shell components
2. shared feedback/status components
3. resident screen components
4. security components
5. staff queue components
6. admin dashboard components

### Implementation Principle

Do not reproduce Figma as unstructured page code.

Instead:

- extract reusable components;
- align them with tokens;
- preserve role-specific density and hierarchy;
- keep product logic in the app architecture, not in design hacks.

## Phase 6 - Review In Code

### Tool

Claude Code plus occasional Claude Design critique

### Goal

Verify that the implemented product still feels like the approved design system.

### Review Questions

- Did implementation preserve the hierarchy?
- Are tokens mapped correctly?
- Did the security UI remain fast and clear?
- Did the resident UI remain premium and calm?
- Did the admin screens avoid generic dashboard drift?

## First-Week Operational Workflow

### Day 1

- Claude Design:
  - decide visual direction
  - choose role hierarchy
- Figma AI:
  - start file structure

### Day 2

- Figma AI:
  - foundations
  - component primitives
- Claude Design:
  - critique token and direction consistency

### Day 3

- Figma AI:
  - first components
- Figma Make:
  - early screen drafts

### Day 4

- Figma AI and Make:
  - resident screens
- Claude Design:
  - resident premium review

### Day 5

- Figma AI and Make:
  - security and staff screens
- Claude Design:
  - operations credibility review

### Day 6

- Figma AI and Make:
  - admin and company dashboards
- Claude Design:
  - dashboard differentiation review

### Day 7

- Claude Design:
  - final critique
- Figma AI:
  - cleanup
- Claude Code:
  - prepare implementation plan

## Artifacts By Tool

### Claude Design Should Produce

- visual direction decisions;
- role-specific UX rationale;
- critique notes;
- simplification and premium checks.

### Figma AI Should Produce

- variables and visual system structure;
- components;
- role screen refinements;
- the main visual source of truth.

### Figma Make Should Produce

- polished first-pass screens;
- quick flow assemblies;
- prototype-like layouts for validation.

### Claude Code Should Produce

- token-aligned implementation;
- reusable React components;
- frontend structure matching the component map;
- production UI rather than one-off mockup clones.

## Rules That Prevent Workflow Drift

- Do not let Claude Design become the long-term visual source of truth.
- Do not let Figma Make define product structure without product review.
- Do not let Claude Code invent new UI patterns without feeding them back into the design system.
- Do not generate every screen before the first components and first critical screens are stable.
- Do not hand implementation exploratory frames that still lack role clarity.

## Core Source Of Truth Stack

Use these files as the workflow spine:

- `domhub-7-day-figma-transition-checklist.md`
- `domhub-figma-file-template.md`
- `domhub-figma-project-copy-paste-outline.md`
- `domhub-design-tokens-css-spec.md`
- `domhub-react-figma-component-map.md`
- `domhub-claude-design-7-day-prompt-pack.md`
- `domhub-figma-ai-make-prompt-pack.md`

## Final Outcome

This workflow is working correctly when:

- Claude Design shapes the product instead of replacing the product file;
- Figma becomes the stable visual source of truth;
- Figma Make accelerates screen creation without causing chaos;
- Claude Code turns approved UI into reusable product code;
- the DomHub experience stays premium, operational, and coherent across all five roles.
