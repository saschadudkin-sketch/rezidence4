# ADR-007: Role IA Harmonization

**Date:** 2026-04-02  
**Status:** Accepted (Phase 1 baseline)  
**Addresses:** A-11 (Deep Audit 2026-04-02)

## Context

Different roles see entirely different tab structures and labels. For example:
- Security/Concierge see "Заявки" for the requests tab
- Resident roles see "Пропуска" for the same tab
- Some roles have 2 tabs, others have 6+

This causes friction when onboarding staff (concierge/security) who work across roles, and makes cross-role support harder.

## Decision

**Phase 1 (done):** Keep role-specific tab sets and labels — they reflect genuinely different workflows. Unifying labels at the cost of semantic clarity would hurt usability for primary users.

**Phase 1 additions:**
- All navigation (desktop + mobile) uses the same badge semantics: count caps with `9+` format, no dots-only
- `getTabsForRole()` is the single source of truth for which tabs are visible per role
- `NAV_META` in Dashboard defines icons, labels, badge counts in one place

**Phase 2 (planned):** Introduce a shared skeleton — a consistent visual frame (position of section title, toolbar, content area, empty state) that applies to all roles. Role-specific content fills the same positions. Users switching between roles find the same page structure.

**Specifically avoid:**
- Renaming "Заявки" to "Пропуска" for concierge — these have distinct meanings
- Showing all tabs to all roles with disabled states — adds cognitive load

## Acceptance criteria

- Every role's navigation has the same visual badge pattern
- Section titles follow the same typography/spacing (use `SectionHeader` component)
- The "active tab" indicator is identical across desktop and mobile nav

## Future work

- `SectionHeader.jsx` component (A-06) provides the consistent section-level skeleton
- Role-specific onboarding tooltips will reduce learning curve without changing IA
