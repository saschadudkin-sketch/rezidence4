---
name: domhub-release-readiness-gates
description: Use when changing DomHub release gates, pilot readiness, Russia readiness, go-live checks, evidence artifacts, rollout runbooks, or production-readiness scripts.
license: project-local
metadata:
  domain: release
  project: DomHub
  source: project-local
---

# DomHub Release Readiness Gates

Use this skill for release gates, go-live readiness, pilot evidence, and rollout scripts.

## Sources

- `docs/product/specs/domhub-release-gate-checklists.md`
- `docs/product/specs/domhub-russia-production-readiness-spec.md`
- `docs/product/specs/platform-v1/go-live-zamoskv-runbook.md`
- `docs/runbooks/pilot-rollout.md`
- `docs/runbooks/pilot-operations-training-pack.md`
- `scripts/release-gate-matrix.cjs`
- `scripts/pilot-readiness-check.cjs`
- `scripts/russia-readiness-check.cjs`

## Rules

- Gates must point to concrete scripts, tests, docs, or evidence artifacts.
- Do not mark a gate complete based only on docs when runtime evidence is required.
- Keep pilot, staging, and production evidence clearly separated.
- Readiness checks should fail closed and explain missing evidence.
- Rollback/restore evidence belongs with go-live readiness, not as an afterthought.

## Commands

- `npm run release:gate:matrix`
- `npm run release:gate:check`
- `npm run pilot:training-pack`
- `npm run pilot:readiness`
- `npm run russia:readiness`

