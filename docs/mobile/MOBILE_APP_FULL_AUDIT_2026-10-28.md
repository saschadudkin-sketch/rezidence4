# Full static audit — Rezidence mobile app and repository integration

**Date:** 2026-10-28  
**Repository:** `saschadudkin-sketch/rezidence4`  
**Branch reviewed:** `codex/mobile-app-foundation`  
**Pull request:** [#154](https://github.com/saschadudkin-sketch/rezidence4/pull/154)

## Scope and confidence

This is a source/configuration review of the repository tree and GitHub metadata. It is not a runtime, penetration, legal, or hardware certification. No production environment, resident account, real SMS, physical Android/iOS device, Apple signing account, or SKUD controller was accessed. The full repository test suite was not executed in this review environment.

## Executive result

**Status: NOT READY for resident pilot or security operations.** The existing platform has substantial backend/frontend modules and security documentation, but the native client is still a UI/API foundation. The current mobile screen contains placeholder actions and no authentication or live resident/pass workflow.

## Findings

### P0 — Do not use the current mobile scaffold to approve entry

The mobile home screen's three actions only show a local informational message. There is no mobile sign-in, pass creation/listing, guard scan, manual verification, or server decision flow. The app README already warns that it must not be used to authorize entry. Keep that warning until end-to-end acceptance tests prove otherwise.

### P1 — Native authentication contract is missing

The existing backend auth routes use OTP and HTTP-only access/refresh cookies; the browser client sends credentials and CSRF headers. The mobile API helper intentionally does not send credentials or bearer tokens. This is the correct conservative choice until a native session contract is defined, but it means protected API calls are not yet usable in the native app.

Required before implementation:
- Specify whether native sessions use bearer access tokens and rotating refresh tokens or another explicit mobile contract.
- Preserve browser cookie/CSRF behavior; do not weaken web security to accommodate mobile.
- Store refresh/session material only in platform secure storage, rotate/revoke sessions, handle logout and account deactivation, and test reuse of old refresh tokens.
- Add server-side tests for missing, expired, rotated, revoked, and cross-tenant sessions.
- Confirm API v1 routes and response shapes against implementation and OpenAPI rather than relying on draft product specs.

### P1 — API helper had a normalized-path escape edge case

The original helper checked only that a path string started with `/api/v1/`. URL normalization can transform a path such as `/api/v1/../auth` into a legacy `/api/auth` path after that check. The helper was hardened in this branch to validate the normalized URL and origin, and to reject credentials/path/query/hash in the configured API base URL. This change is source-reviewed but not yet typechecked or runtime-tested.

### P1 — Mobile package is not in the CI/release gate

The repository's existing CI workflow runs backend/frontend and governance checks, but no mobile-specific job is configured. The mobile app has no committed package lockfile, and its Expo dependency versions have not been verified with `npx expo install --check`. A reproducible native build and a CI gate are still missing. Do not claim SDK compatibility until install/check/typecheck/build has run.

The unused AsyncStorage dependency and the `expo lint` script (without a local ESLint configuration/dependency declared by this package) were removed from the mobile package manifest. A lockfile still needs to be generated with the intended Expo SDK and reviewed.

### P1 — Current CI status is not evidence of a pass

The latest workflow runs returned by GitHub were on the default branch in July 2026 and were marked failed. In the most recent retrieved CI run, the backend tests and frontend test/build/verification jobs completed successfully, but the Docker Compose smoke job and governance security-scan job failed; dependent jobs were skipped. The nightly Playwright smoke run also failed. The logs for those historical failures are no longer downloadable (GitHub returned HTTP 410), so the exact causes remain unverified. No run for the current PR head was present in the retrieved run list, and the current head had no commit statuses. This does not prove every current source file fails; it means there is no current passing CI evidence. A fresh run and investigation of the old failures are required before merge/release.

### P1 — QR, manual check, and SKUD integration are not connected to the native app

The repository documents access APIs and security controls, but the native client does not call them yet. QR payloads must remain non-authoritative; the server must check expiry, revocation, tenant/property scope, time window, access point/zone, one-time use, and policy. A guard UI must distinguish “verified/allowed”, “denied”, “network unavailable”, and “manual override”, with audit actor, checkpoint, time, reason, and reviewability. Offline mode must never turn an unverified pass into an approval.

The actual SKUD vendor/model/protocol and sandbox credentials are not established by this audit. Hardware integration cannot be certified without them.

### P1 — Production deployment and Russian personal-data readiness are unverified

Repository documents discuss 152-FZ, localization, retention, consent/legal basis, audit and incident handling, but documents alone do not prove operational compliance. Before pilot, the responsible operator must confirm hosting/data location, controller/operator roles, data categories and retention, access to sensitive records, incident response, backups/restore, and production SMS/push configuration. Example configuration values such as `SMSRU_API_ID=STUB` are placeholders, not production evidence.

### P2 — Closed distribution and device acceptance are not set up

The Expo configuration contains Android/iOS identifiers, but no verified signed builds, store/internal distribution setup, signing credentials, privacy disclosures, push credentials, or physical-device acceptance evidence were confirmed. Choose the distribution model and test installation/update/revocation on both platforms before inviting residents.

### P2 — The current home screen is a visual shell, not a complete UX

The resident-facing design is coherent and mobile-first, but the screen currently advertises actions that do not navigate or complete tasks. Until the flows are connected, label the build as a prototype/internal preview. Before pilot, test accessibility labels, text scaling, loading/error/empty states, slow network behavior, session expiry, and small-screen layouts.

## Verified repository facts

- Root project defines backend/frontend tests, typecheck/lint/build, E2E, OpenAPI drift and security/release gates.
- Backend has OTP, refresh rotation, logout, session revocation code and auth tests.
- Frontend uses cookie-based auth/refresh and CSRF headers.
- Native app is an Expo/React Native/TypeScript scaffold with an HTTPS-oriented API helper and SecureStore dependency.
- The current native screen has no real server-backed actions.
- No native mobile CI job or mobile lockfile is present in the reviewed branch.

## Required gate before calling this “ready”

1. Generate and commit a reviewed mobile lockfile; validate Expo SDK dependency alignment.
2. Add a native auth/session contract and backend integration tests while preserving web sessions.
3. Add mobile CI for install, Expo config validation, typecheck, lint/static analysis, and platform builds.
4. Connect resident workflows to existing v1 API contracts and add contract tests.
5. Implement guard verification with server-authoritative results and audit events; never approve locally/offline.
6. Run the existing backend/frontend/governance/E2E suite and investigate failures; obtain a green current PR run.
7. Validate Android and iOS builds on physical devices, including session expiry, notifications, accessibility, and update path.
8. Complete SKUD sandbox acceptance, data-protection/operational review, backup/restore evidence, and closed-distribution setup.

## Evidence limitations

This document records what was visible in checked-in source and GitHub metadata at review time. Any control not explicitly tested above remains **unverified**, not implicitly passed.
