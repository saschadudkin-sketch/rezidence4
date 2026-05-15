---
name: domhub-release-readiness-audit
description: Use when auditing DomHub release readiness before pilot, staging, production, or go-live. Checks release gates, tenant preflight, restore drill, security scans, E2E, critical coverage, evidence artifacts, and rollout runbooks.
license: project-local
metadata:
  domain: release-audit
  project: DomHub
  source: project-local
---

# DomHub Release Readiness Audit

Use this skill before a release, pilot, staging rollout, or production go-live.

## Sources

- `docs/product/specs/domhub-release-gate-checklists.md`
- `docs/product/specs/domhub-russia-production-readiness-spec.md`
- `docs/product/specs/platform-v1/go-live-zamoskv-runbook.md`
- `docs/runbooks/pilot-rollout.md`
- `docs/runbooks/restore-drill.md`
- `scripts/release-gate-matrix.cjs`
- `scripts/pilot-readiness-check.cjs`
- `scripts/russia-readiness-check.cjs`
- `scripts/restore-drill*.cjs`

## Required Audit Areas

- Test status: backend, frontend, E2E, critical coverage.
- Contract status: OpenAPI drift and generated frontend types.
- Tenant readiness: registry/property DB preflight and current migrations.
- Restore readiness: backup freshness and restore drill evidence.
- Security readiness: gitleaks, semgrep, secrets, signed uploads, auth config.
- Realtime readiness: SSE/Redis health where relevant.
- Evidence readiness: pilot, staging, Russia readiness, field rollout, emergency drill, DSAR/PDn artifacts.
- Rollback readiness: runbook, owner, RTO/RPO evidence, and decision criteria.

## Commands

- `npm run verify`
- `npm run release:gate:check`
- `npm run tenant:preflight:current`
- `npm run tenant:restore-drill:preflight`
- `npm run pilot:readiness`
- `npm run russia:readiness`
- `npm run security:scan`

## Output

```text
Verdict: PASS|WARN|FAIL

Blocking issues:
- ...

Non-blocking risks:
- ...

Evidence reviewed:
- ...

Commands run:
- command - pass/fail/not run, reason
```

