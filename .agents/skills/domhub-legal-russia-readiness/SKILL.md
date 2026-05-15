---
name: domhub-legal-russia-readiness
description: Use when changing DomHub Russian production readiness, legal/compliance docs, PDn/DSAR evidence, GIS/OSS readiness, pilot/staging evidence, public legal pages, or B2B legal artifacts.
license: project-local
metadata:
  domain: legal
  project: DomHub
  source: project-local
---

# DomHub Legal Russia Readiness

Use this skill for legal documentation, Russia readiness, compliance evidence, and public/B2B legal artifacts.

## Sources

- `docs/product/specs/domhub-russia-production-readiness-spec.md`
- `docs/product/specs/platform-v1/gis-oss-readiness-spec.md`
- `docs/legal/`
- `docs/runbooks/russia-readiness-evidence-capture.md`
- `scripts/russia-readiness-check.cjs`

## Rules

- Product behavior and legal docs must stay aligned.
- Do not claim legal certification unless the evidence supports it.
- PDn/DSAR, retention, deletion, incident response, contractor access, and backup docs should map to implemented controls or explicit roadmap gaps.
- Live evidence artifacts must distinguish pilot, staging, and production.
- Public legal pages should avoid implementation-only jargon but must match actual data practices.

## Commands

- `npm run russia:readiness`
- `npm run pilot:readiness`
- `npm run tenant:restore-drill:preflight`
- `npm run security:scan`

