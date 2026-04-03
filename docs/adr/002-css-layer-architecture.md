# ADR-002: CSS Layer Architecture

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-02, A-13 (Deep Audit 2026-04-02)

## Context

`theme.css` was a single ~2300-line file containing design tokens, resets, all component styles, and feature-specific styles. This created high coupling: any visual change touched the same file, making diff-reviews hard and risking side-effects.

Additionally, the global `*:focus{outline:none}` reset (A-13) suppressed keyboard focus indicators universally — risky in non-standard browsers where `:focus-visible` polyfill behavior varies.

## Decision

### CSS layers

Split into three layers imported in order from `App.jsx`:

```
tokens.css      — CSS custom properties (:root) + theme variants (light/dark)
foundations.css — Global resets, html/body base, keyframe animations
theme.css       — Component + feature styles (trimmed, no tokens or resets)
```

This is an incremental split (no big-bang rewrite). Future iterations should further decompose `theme.css` into `components/*.css` and `features/*.css` per the full plan.

### A11y focus fix

Replaced:
```css
*:focus { outline: none }
*:focus-visible { outline: 2px solid var(--g1); ... }
```

With the spec-compliant single rule:
```css
:focus:not(:focus-visible) { outline: none }
:focus-visible { outline: 2px solid var(--g1); ... }
```

`:focus:not(:focus-visible)` is equivalent and more explicit: it hides the ring only when `:focus-visible` would not apply (mouse/touch interaction), and shows it on keyboard navigation. This avoids the cascade dependency on ordering.

## Consequences

- `theme.css` is no longer a single point of failure for the entire visual system.
- Tokens are now isolated — updating a color/spacing variable has zero risk of introducing unwanted cascade effects.
- Foundations layer is independently auditable for reset hygiene and accessibility.
- A11y: keyboard focus ring is guaranteed to show via `:focus-visible` without relying on cascade order of two separate rules.
- Next step: decompose remaining `theme.css` into `components/` and `features/` subdirectories.
