# DomHub Implementation Order

This file exists to give agents a short, stable execution order for DomHub development without re-reading the entire planning corpus first.

## Primary Rule

Implement DomHub in this order unless the user explicitly overrides it:

1. Multi-tenant platform foundation
2. Property structure and role/scope model
3. Resident access flows
4. Security / guard workflows
5. Requests + staff workspace baseline
6. Vehicle access
7. Contractor / technician operational flows
8. Access zones / points / policies
9. Incidents / audit maturity
10. Management company portfolio layer
11. Integrations
12. Growth modules

## Access-Specific Rule

For access-control work, do not jump to deep integrations before the following are stable:

1. Internal access data model
2. Access policies
3. State transitions
4. Security workspace
5. Vehicle access
6. Contractor/service access
7. Incident handling

## Source Of Truth

Read these in order when deeper context is needed:

1. `docs/product/specs/README.md`
2. `docs/product/specs/domhub-final-product-plan.md`
3. `docs/product/specs/domhub-access-platform-final-plan.md`
4. `docs/product/specs/domhub-access-data-model-spec.md`
5. `docs/product/specs/domhub-access-policy-spec.md`
6. `docs/product/specs/domhub-state-machines-spec.md`
7. `docs/product/specs/domhub-access-api-contract-spec.md`

## Non-goal Rule

Do not prioritize:
- billing
- OCR
- booking
- AI modules
- broad smart-home expansion

before the operational access core is strong.

