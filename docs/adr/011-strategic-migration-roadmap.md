# ADR-011: Strategic frontend migration roadmap after deep audit

## Status
Accepted — 2026-04-05

## Context
Deep audit identified 5 remaining strategic areas:
1. Unified UX contract for loading/empty/error across all role screens.
2. Full CSS breakpoint normalization.
3. Deeper bounded-context modularization of AppStore.
4. Product-level telemetry/SLA contract.
5. Architecture migration governance for next milestones.

## Decision
Adopt phased migration with enforceable gates:

### Phase A — UX state contract (2 sprints)
- All views must use `StateBlock` + `viewStateContract` copy registry.
- No raw custom empty/error/loading blocks in new code.
- PR check: at least one unit/smoke test for each critical state.

### Phase B — Breakpoint governance (1 sprint)
- Allowed breakpoints set: 380, 400, 460, 480, 500, 560, 580, 600, 680, 768, 860, 1024.
- `check-style-governance.js` blocks non-standard widths.

### Phase C — Store bounded contexts (3 sprints)
- Move action-domain routing to separate modules.
- Introduce per-domain selectors and side-effect boundaries.
- Keep AppStore as composition root only.

### Phase D — Telemetry/SLA (2 sprints)
- Contract events: `ux.view_ready`, `ux.action_success`, `sse.reconnect.ms`, `sse.connection.timeout`.
- Build dashboards for p95 reconnect and screen-ready times.

### Phase E — Strategic architecture migration (ongoing)
- Role manifest becomes single source for tabs/titles/default route.
- Expand realtime state machine to health model (`healthy/degraded/failed`).
- Monthly architecture review with KPIs.

## Consequences
- Faster feature delivery with lower regression risk.
- Predictable UX across roles and states.
- Clear quality gates for SaaS maturity.
