# DomHub Implementation Order

This file exists to give agents a short, stable execution order for DomHub development without re-reading the entire planning corpus first.

## Primary Rule

Implement DomHub in this order unless the user explicitly overrides it:

1. Multi-tenant platform foundation
2. Property structure, territory mode, and role/scope model
3. Resident lifecycle, ownership links, and personal-data baseline
4. Access zones / points topology
5. Resident / guest access flows
6. Vehicle and checkpoint access baseline
7. Access policy baseline
8. Security / guard workflows
9. Requests, emergency dispatch, and staff workspace baseline
10. Contractor / technician operational flows
11. Incidents, sensitive-action audit, and abuse review
12. Management company portfolio layer
13. Russia production readiness, GIS/OSS, and pilot runbooks
14. Integrations and hardware adapter maturity
15. Growth modules
16. Legacy runtime removal after v1 cutover is proven

## Access-Specific Rule

For access-control work, do not jump to deep integrations before the following are stable:

1. Internal access data model
2. Property-type / residential-territory baseline
3. Access zones / points topology
4. State transitions and pass lifecycle
5. Access policy baseline
6. Vehicle and checkpoint verification
7. Degraded checkpoint mode
8. Security workspace and manual decisions
9. Contractor/service access
10. Incident handling, video evidence references, and sensitive-action audit

## Source Of Truth

Read these in order when deeper context is needed:

1. `docs/product/specs/README.md`
2. `docs/product/specs/domhub-final-product-plan.md`
3. `docs/product/specs/domhub-residential-territory-model-spec.md`
4. `docs/product/specs/domhub-russia-production-readiness-spec.md`
5. `docs/product/specs/domhub-access-platform-final-plan.md`
6. `docs/product/specs/domhub-access-data-model-spec.md`
7. `docs/product/specs/domhub-access-policy-spec.md`
8. `docs/product/specs/domhub-state-machines-spec.md`
9. `docs/product/specs/domhub-access-api-contract-spec.md`
10. `docs/product/specs/domhub-security-threat-model.md`
11. `docs/product/specs/domhub-release-gate-checklists.md`
12. `docs/product/specs/domhub-operational-runbooks-index.md`
13. `docs/product/specs/domhub-event-taxonomy-spec.md`
14. `docs/product/specs/domhub-ui-screen-map.md`

## Property-Type Rule

For features that touch property structure, address labels, guard/checkpoint workflows, onboarding imports, or vehicle-first access, support `residential_complex`, `club_house`, and `cottage_community` as first-class modes. Do not leak apartment-only labels into cottage-community flows.

## Russia Readiness Rule

For features that touch residents, vehicles, visitors, video evidence, emergency operations, exports, integrations, or staff/admin sensitive actions, check `domhub-russia-production-readiness-spec.md` before implementation. Do not add biometric identity matching, legally authoritative OSS voting, or certified GIS ЖКХ behavior as part of core unless a separate approved spec exists.

## Non-goal Rule

Do not prioritize:
- billing
- OCR
- booking
- AI modules
- broad smart-home expansion
- full legacy runtime removal

before the operational access core is strong.

