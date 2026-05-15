---
name: domhub-feature-flags-packaging
description: Use when changing DomHub feature flags, package layers, enterprise integrations, route gating, admin feature visibility, rollout configuration, or legacy utility freeze behavior.
license: project-local
metadata:
  domain: feature-flags
  project: DomHub
  source: project-local
---

# DomHub Feature Flags Packaging

Use this skill for feature gating, package tiers, rollout visibility, and legacy freeze behavior.

## Sources

- `docs/product/specs/domhub-packaging-and-feature-gating-spec.md`
- `docs/product/specs/platform-v1/legacy-utilities-freeze-spec.md`
- `backend/src/config/featureFlags.js`
- backend `requireFeature` middleware.
- frontend admin features and route visibility.

## Rules

- Gates must be enforced server-side; frontend visibility is not authorization.
- Package tiers should align with product specs and rollout plans.
- Enterprise-only integrations must not leak into lower package behavior.
- Default states must be explicit for dev, test, demo, staging, and production.
- Legacy utilities should remain frozen unless an explicit migration plan reopens them.

## Checks

- Run feature flag registry tests.
- Run route tests for server-side gating.
- Run frontend visibility tests when admin feature UI changes.

