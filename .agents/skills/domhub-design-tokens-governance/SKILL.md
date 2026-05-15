---
name: domhub-design-tokens-governance
description: Use when changing DomHub design tokens, CSS architecture, visual state matrix, Figma/component mapping, Storybook stories, UI governance scripts, or shared frontend styling.
license: project-local
metadata:
  domain: design-system
  project: DomHub
  source: project-local
---

# DomHub Design Tokens Governance

Use this skill for design-system, token, CSS, and visual governance work.

## Sources

- `docs/product/specs/domhub-design-tokens-css-spec.md`
- `docs/product/specs/domhub-react-figma-component-map.md`
- `docs/product/specs/domhub-ui-screen-map.md`
- `frontend/src/design-system/`
- `frontend/src/ui/`
- `frontend/src/styles/`
- frontend verify scripts for style, UX contract, visual state matrix, and design governance.

## Rules

- Prefer existing tokens and components before adding new styles.
- Keep operational UI dense, scannable, and role-specific.
- Avoid component-local token drift.
- Visual states should include loading, empty, error, disabled, long text, role-limited, and mobile layouts.
- Do not fix visual issues by weakening governance scripts unless the rule itself is wrong.

## Commands

- `cd frontend && npm run verify:styles`
- `cd frontend && npm run verify:ux-contract`
- `cd frontend && npm run verify:visual-state-matrix`
- `cd frontend && npm run verify:design-governance`
- `cd frontend && npm run storybook:build`

