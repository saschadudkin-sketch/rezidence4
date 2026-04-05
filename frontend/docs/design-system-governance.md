# Design System Governance

## Component Inventory (core UI)

| Area | Components | Mandatory states |
|---|---|---|
| Actions | `btn-gold`, `btn-outline`, `PageActionBar` | default, hover, active, disabled, focus-visible |
| Navigation | `NavigationShell` (`tn-btn`, `mn-btn`, `QuickActionsSheet`) | default, active, badge, overflow-open, focus-visible |
| Feedback | `StateBlock`, `Toasts`, `badge`, `field-err` | loading, empty, error, success |
| Data display | `ReqCard`, `VirtualList`, `AdminUserRow` | default, hovered, selected/active, high-density |
| Inputs | `search-inp`, `field-inp`, `textarea` | default, focus, error, disabled |

## Hard design rules

1. **Spacing scale only**: use spacing tokens/utilities (`--space-*`, `u-mb*`) for layout rhythm.
2. **Focus ring is mandatory**: interactive controls must have a visible `:focus-visible` treatment.
3. **Density budget**: no more than 2 stacked accent layers per card/surface.
4. **Motion budget**: only one attention animation per viewport region at once.
5. **State completeness**: every reusable component must define default/hover/active/disabled/error if applicable.
6. **Accent budget (screen level)**: max **1 primary accent** + **1 status accent** simultaneously.

## Review checklist (release gate)

- [ ] All touched interactive components have keyboard-visible focus state.
- [ ] Disabled state is visually distinguishable (opacity/contrast + no pointer action).
- [ ] Empty/error/loading states are explicit for async resources.
- [ ] New components added to inventory table.
- [ ] Playwright visual-state snapshots updated for impacted screens.
