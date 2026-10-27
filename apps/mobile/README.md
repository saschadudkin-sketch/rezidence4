# Native app workspace

This directory is reserved for the native Android/iOS client for «Резиденции Замоскворечья».

The native app has intentionally **not** been scaffolded with a guessed authentication implementation. The existing backend's OTP flow uses HTTP-only cookies, and native session behavior must be explicitly specified and tested before wiring a mobile login screen to production data.

Read first:

- [Mobile readiness audit](../../docs/mobile/MOBILE_APP_READINESS_2026-10-27.md)
- [Implementation plan](../../docs/mobile/MOBILE_APP_IMPLEMENTATION_PLAN.md)
- [Access API contract](../../docs/product/specs/domhub-access-api-contract-spec.md)
- [Security threat model](../../docs/product/specs/domhub-security-threat-model.md)
- [Russia production readiness](../../docs/product/specs/domhub-russia-production-readiness-spec.md)

Planned stack: React Native, Expo, TypeScript, Expo Router, platform secure storage, and the existing versioned API.

Do not add real resident data, production credentials, signing keys, or a fake/demo access decision to this workspace.
