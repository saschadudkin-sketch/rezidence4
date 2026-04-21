# DomHub Product Specs Index

This directory contains the working product source of truth for DomHub platform development.

## Primary Document

- `domhub-final-product-plan.md`
  - Master roadmap/specification for the target product, final platform shape, phase order, release gates, risks, and success metrics.

## Supporting Planning Documents

- `domhub-backlog-epics.md`
  - Product backlog organized by epics, priorities, dependencies, and definition of done.

- `domhub-technical-streams-plan.md`
  - Stream-based technical plan for backend, frontend, data, integrations, legal/compliance, and operations.

- `domhub-12-week-sprint-plan.md`
  - Suggested 12-week execution plan for delivering the strong v2 core and portfolio-ready baseline.

- `domhub-work-breakdown.md`
  - Work breakdown to `database / API / UI / tests / docs` level.

## Legacy / Higher-Level Reference

- `platform-spec.md`
  - Shorter platform summary document. Use the newer files above for detailed delivery and planning decisions.

## Usage Guidance

- When implementing new DomHub platform features, start with `domhub-final-product-plan.md`.
- When deciding priority or order, use `domhub-backlog-epics.md` and `domhub-12-week-sprint-plan.md`.
- When decomposing engineering work, use `domhub-technical-streams-plan.md` and `domhub-work-breakdown.md`.
- If the user gives instructions that conflict with these files, follow the user and then update the docs accordingly.
