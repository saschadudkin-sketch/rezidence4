# DomHub — Docs Health And Remaining Gaps

Дата: 2026-05-05
Статус: рабочий docs-health list
Назначение: фиксировать, какие supporting specs уже закрыты, какие остаются недостающими, и какие документы не являются source-of-truth.

---

## 1. Правило приоритета

Этот файл не override-ит `domhub-final-product-plan.md`. Если здесь есть расхождение с master-plan, `README.md`, `IMPLEMENTATION_ORDER.md` или `ACCESS_SOURCE_OF_TRUTH.md`, нужно обновить этот файл как docs-health список.

Главный источник продуктовой стратегии:
- `domhub-final-product-plan.md`

Главные execution/backlog источники:
- `domhub-master-jira-backlog.md`
- `domhub-platform-jira-ready-backlog.md`
- `domhub-access-jira-ready-backlog.md`
- `domhub-12-week-sprint-plan.md`
- `domhub-work-breakdown.md`

---

## 2. Уже создано и считается активным

### Product And Territory

- `domhub-final-product-plan.md`
- `domhub-residential-territory-model-spec.md`
- `domhub-russia-production-readiness-spec.md`
- `domhub-role-maturity-matrix.md`

### Access Core

- `domhub-access-platform-final-plan.md`
- `domhub-access-core-production-slice-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-api-contract-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-state-machines-spec.md`

### Quality, Ops, Integrations, Packaging

- `domhub-security-threat-model.md`
- `domhub-test-strategy-spec.md`
- `domhub-release-gate-checklists.md`
- `domhub-deployment-and-tenant-ops-spec.md`
- `domhub-operational-runbooks-index.md`
- `domhub-integration-architecture-spec.md`
- `domhub-event-taxonomy-spec.md`
- `domhub-analytics-metric-definitions.md`
- `domhub-packaging-and-feature-gating-spec.md`
- `domhub-skud-vendor-priority-spec.md`
- `domhub-video-integration-spec.md`
- `domhub-erp-1c-integration-spec.md`
- `domhub-ui-screen-map.md`

### Delivery

- `domhub-backlog-epics.md`
- `domhub-master-jira-backlog.md`
- `domhub-access-jira-ready-backlog.md`
- `domhub-platform-jira-ready-backlog.md`
- `domhub-jira-import.csv`
- `domhub-jira-import-v2.csv`
- `domhub-master-backlog-sprint-team-plan.md`
- `domhub-technical-streams-plan.md`
- `domhub-12-week-sprint-plan.md`
- `domhub-work-breakdown.md`

### Sub-Indexes And Optional Reference Groups

- `platform-v1/README.md`
- parking module docs
- commercial tenant module docs
- first-working-MVP docs
- Figma/design workflow docs

Optional/reference groups are valid planning inputs only when their module is in scope. They do not override the master product roadmap.

---

## 3. Remaining Gaps

### P0/P1

No active P0/P1 docs gaps remain in this list as of 2026-05-05. Newly created supporting specs:
- `domhub-security-threat-model.md`;
- `domhub-release-gate-checklists.md`;
- `domhub-operational-runbooks-index.md`;
- `domhub-event-taxonomy-spec.md`;
- `domhub-ui-screen-map.md`.

### P2 — when module scope becomes active

1. Module-specific extensions for parking, commercial tenants, billing, payments, OCR, booking, and AI-assisted workflows.
   - Create or update only when the module is explicitly in scope.

---

## 4. Cleanup Rules

- Delete only files that are both obsolete and unreferenced.
- Mark as optional/reference when a document is useful but not a source of truth.
- Mark as superseded when a document is historically useful but replaced by a newer source.
- Keep `platform-v1/*` specs: they are implementation/migration references covered by `platform-v1/README.md`.
- Do not delete parking, commercial tenant, first-working-MVP, or design/Figma docs without a separate explicit decision.

---

## 5. Current Docs Health Snapshot

- Master product plan covers ЖК, club house, cottage community, access, requests, Russia readiness, integrations, pilot operations, and growth boundaries.
- Root README indexes active top-level source-of-truth and supporting documents.
- `platform-v1/*` is covered by its own sub-index.
- Security threat model, release gates, runbook index, event taxonomy and UI screen map are now active supporting specs.
- Jira/master backlog range is `DH-01` through `DH-61`.
- Russia Production Readiness is represented by `DH-55` through `DH-61`.
- Expansion layer remains `DH-50` through `DH-54` and is scheduled after readiness.
