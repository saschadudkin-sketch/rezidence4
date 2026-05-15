---
name: storybook-design-system
description: Use when changing DomHub Storybook stories, design-system components, visual states, component documentation, a11y checks, or UI governance around reusable frontend components.
license: project-local
metadata:
  domain: frontend
  project: DomHub
  source: project-local
---

# Storybook Design System

Use this skill for `frontend/src/stories`, `frontend/src/design-system`, reusable UI components, and visual state coverage.

## Rules

- Stories should show real component states: default, loading, empty, error, disabled, permission-limited, long text, and mobile-constrained layouts.
- Use domain-realistic data for DomHub roles, passes, requests, residents, notifications, and access states.
- Keep controls useful but bounded; avoid exposing implementation-only props as primary knobs.
- Include accessibility-sensitive states for modals, menus, forms, focus, and validation.
- Do not introduce story-only styling that hides component defects.
- Keep stories aligned with design governance scripts and visual state matrix expectations.

## Commands

- `cd frontend && npm run storybook`
- `cd frontend && npm run storybook:build`
- `cd frontend && npm run verify:visual-state-matrix`
- `cd frontend && npm run verify:design-governance`
- `cd frontend && npm run verify:modal-a11y`

