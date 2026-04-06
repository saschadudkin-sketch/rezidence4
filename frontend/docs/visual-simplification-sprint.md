# Visual Simplification Sprint (Premium Calmness)

## Goals
- Reduce alert/banner density per screen.
- Enforce spacing rhythm (8px baseline).
- Unify microcopy tone to neutral/reassuring voice.
- Limit accent states to semantic purpose only.

## Scope
1. **Navigation & Header**: fewer concurrent badges, one primary status signal.
2. **Recovery UI**: shared `ErrorRecoveryPanel` + consistent CTA order.
3. **State Surfaces**: `ViewStateAdapter` across async modules.
4. **Color Discipline**: reserve warning/error hues for blocking incidents.

## Acceptance Criteria
- No screen shows >1 critical banner at a time.
- Recovery CTAs follow one order: Retry → Fallback.
- New UI copy passes tone review checklist.
- Utility style additions stay within governance budgets.
