# DomHub Design Tokens CSS Spec

This document defines the first production-ready CSS variable token layer for DomHub.

## Purpose

- Create a shared token contract between design and frontend
- Support the DomHub premium visual direction
- Keep one consistent system across resident, security, staff, property admin, and management company interfaces

## Design Direction

- Tone: quiet luxury operations
- Base mode: light-first
- Product feel: premium residential, operationally calm, trustworthy, precise
- Color strategy: warm neutrals + deep operational green + restrained semantic states

## Usage Rules

- Use semantic tokens in components whenever possible.
- Use raw palette tokens only in theme or token definition layers.
- Prefer density and typography changes by role instead of inventing new color systems per role.
- Security UI may use stronger contrast but must stay within the same token family.

---

## CSS Variable Contract

```css
:root {
  /* Brand */
  --color-brand-forest-900: #1f342e;
  --color-brand-forest-800: #25433b;
  --color-brand-forest-700: #31564c;
  --color-brand-forest-600: #3e6c60;

  /* Warm neutrals */
  --color-ivory-50: #fcfaf7;
  --color-ivory-100: #f6f2ea;
  --color-ivory-200: #ede6da;
  --color-ivory-300: #ddd1bf;

  /* Ink */
  --color-graphite-900: #1f2326;
  --color-graphite-800: #2a2f33;
  --color-graphite-700: #41474c;
  --color-graphite-500: #6e7377;

  /* Accent */
  --color-gold-500: #b89a6a;
  --color-gold-400: #c8ae84;

  /* Semantic */
  --color-success-600: #2e6b57;
  --color-warning-600: #a06a2c;
  --color-danger-600: #a44e45;
  --color-info-600: #48637a;

  /* Surface */
  --surface-base: var(--color-ivory-100);
  --surface-subtle: var(--color-ivory-50);
  --surface-elevated: #ffffff;
  --surface-selected: #f1ece4;
  --surface-disabled: #f3f0ea;
  --surface-contrast: var(--color-graphite-900);

  /* Text */
  --text-primary: var(--color-graphite-900);
  --text-secondary: var(--color-graphite-700);
  --text-muted: var(--color-graphite-500);
  --text-inverse: #ffffff;
  --text-accent: var(--color-brand-forest-800);
  --text-danger: var(--color-danger-600);

  /* Borders */
  --border-subtle: #e7ded0;
  --border-default: #d7cbb8;
  --border-strong: #bbae98;
  --border-focus: var(--color-brand-forest-700);
  --border-danger: var(--color-danger-600);

  /* Buttons */
  --button-primary-bg: var(--color-brand-forest-800);
  --button-primary-bg-hover: var(--color-brand-forest-700);
  --button-primary-text: #ffffff;

  --button-secondary-bg: #ffffff;
  --button-secondary-bg-hover: var(--surface-subtle);
  --button-secondary-text: var(--text-primary);
  --button-secondary-border: var(--border-default);

  --button-danger-bg: var(--color-danger-600);
  --button-danger-text: #ffffff;

  /* Status pills */
  --status-success-bg: rgba(46, 107, 87, 0.10);
  --status-success-text: var(--color-success-600);
  --status-warning-bg: rgba(160, 106, 44, 0.12);
  --status-warning-text: var(--color-warning-600);
  --status-danger-bg: rgba(164, 78, 69, 0.10);
  --status-danger-text: var(--color-danger-600);
  --status-info-bg: rgba(72, 99, 122, 0.10);
  --status-info-text: var(--color-info-600);

  /* Typography */
  --font-family-ui: "Manrope", "Inter", sans-serif;
  --font-family-display: "Cormorant Garamond", "Times New Roman", serif;

  --font-size-display-xl: 56px;
  --line-height-display-xl: 64px;
  --font-size-display-lg: 44px;
  --line-height-display-lg: 52px;

  --font-size-heading-xl: 32px;
  --line-height-heading-xl: 40px;
  --font-size-heading-lg: 24px;
  --line-height-heading-lg: 32px;
  --font-size-heading-md: 20px;
  --line-height-heading-md: 28px;

  --font-size-body-lg: 16px;
  --line-height-body-lg: 26px;
  --font-size-body-md: 14px;
  --line-height-body-md: 22px;
  --font-size-body-sm: 12px;
  --line-height-body-sm: 18px;

  --font-size-label-md: 13px;
  --line-height-label-md: 18px;
  --font-size-label-sm: 11px;
  --line-height-label-sm: 16px;

  --font-size-metric-xl: 36px;
  --line-height-metric-xl: 40px;
  --font-size-metric-lg: 28px;
  --line-height-metric-lg: 32px;

  /* Font weights */
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Radius */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-pill: 999px;

  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(24, 29, 33, 0.06);
  --shadow-md: 0 8px 24px rgba(24, 29, 33, 0.08);
  --shadow-lg: 0 16px 40px rgba(24, 29, 33, 0.10);

  /* Motion */
  --motion-fast: 160ms;
  --motion-base: 200ms;
  --motion-slow: 260ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-enter: cubic-bezier(0.18, 0.9, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);

  /* Layout */
  --content-max-width: 1440px;
  --sidebar-width: 280px;
  --topbar-height: 72px;
  --panel-gap: var(--space-6);
}
```

---

## Density Tokens By Role

```css
:root {
  --density-resident-card-padding: var(--space-6);
  --density-resident-grid-gap: var(--space-6);

  --density-staff-row-height: 60px;
  --density-staff-panel-padding: var(--space-5);

  --density-security-row-height: 56px;
  --density-security-action-height: 48px;

  --density-admin-table-row-height: 52px;
  --density-admin-panel-padding: var(--space-5);

  --density-company-table-row-height: 48px;
  --density-company-grid-gap: var(--space-5);
}
```

## Semantic Surface Recipes

Use these recipes instead of inventing one-off card colors.

```css
:root {
  --card-bg-default: var(--surface-elevated);
  --card-bg-muted: var(--surface-subtle);
  --card-bg-selected: var(--surface-selected);
  --card-border-default: var(--border-subtle);
  --card-shadow-default: var(--shadow-sm);

  --panel-bg-default: var(--surface-elevated);
  --panel-border-default: var(--border-default);

  --dashboard-metric-bg: #fffdfa;
  --dashboard-metric-border: #e6dbc8;

  --security-console-bg: #f5f1ea;
  --security-decision-allow-bg: rgba(46, 107, 87, 0.10);
  --security-decision-deny-bg: rgba(164, 78, 69, 0.10);
}
```

## Suggested Token Export Groups For Figma

- `Color / Brand`
- `Color / Neutral`
- `Color / Semantic`
- `Surface`
- `Text`
- `Border`
- `Typography`
- `Spacing`
- `Radius`
- `Shadow`
- `Motion`
- `Density`

## First Implementation Targets

Apply these tokens first to:

1. resident home
2. guest pass flow
3. security workspace
4. staff request queue
5. property admin dashboard

## Notes

- Resident UI should feel more spacious than staff and security surfaces.
- Security should increase contrast and action clarity without becoming visually aggressive.
- Property admin and management company screens should reuse the same token system with denser data layouts, not a different visual language.
