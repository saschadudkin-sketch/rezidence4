# Native app — Резиденции Замоскворечья

A first native-client scaffold for Android and iOS, built with React Native, Expo, TypeScript, and Expo Router.

## Current state

Implemented in this branch:
- Expo application configuration and resident-facing home-screen shell.
- Restrained, light visual system aligned with the product's resident-first design principles.
- Typed API request helper restricted to versioned `/api/v1/*` paths and HTTPS outside local development.
- Safe, user-readable API error messages that do not expose response bodies.
- Explicit setup status on the home screen so placeholder UI is not mistaken for live access data.

Not implemented yet:
- Native OTP/session lifecycle.
- Live resident, unit, pass, and visitor data.
- QR generation or scan-based access decisions.
- Push notifications.
- SKUD hardware integration.
- Production signing, store distribution, or verified device builds.

**Do not use this scaffold to authorize entry.** It has no live access decision flow.

## Local development

Requires Node.js compatible with the selected Expo SDK and Android Studio and/or Xcode for native device builds.

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_API_BASE_URL` to a trusted HTTPS staging API origin. Do not use a production URL until the mobile auth contract is implemented and reviewed.
3. From this directory run `npm install`.
4. Run `npx expo install --check` and resolve any SDK version mismatch before starting.
5. Run `npx expo start`; open the project in Expo Go only if the selected SDK is supported, otherwise use a development build.
6. Run `npm run typecheck`.

The root repository's current lockfile does not include this standalone mobile package. Generate and review a package lock from this directory before treating builds as reproducible or using CI/release automation.

## Architecture and security

- Use the existing versioned backend API; do not duplicate access-policy logic in the client.
- The API helper intentionally does not add bearer-token or cookie auth until a native session contract is approved and tested.
- Keep tokens in platform secure storage, not AsyncStorage, logs, URLs, or app configuration.
- QR payloads must not contain personal data. A QR scan is a lookup request, not proof of authorization.
- The server must decide whether a pass is valid, active, in-window, in-scope, unused where required, and permitted at the target point.
- Offline behavior must never convert an unverified pass into an approval.
- Never commit real credentials, resident data, signing keys, or production endpoints with embedded secrets.

## Documentation

- [Readiness audit](../../docs/mobile/MOBILE_APP_READINESS_2026-10-27.md)
- [Implementation plan](../../docs/mobile/MOBILE_APP_IMPLEMENTATION_PLAN.md)
- [Access API contract](../../docs/product/specs/domhub-access-api-contract-spec.md)
- [Security threat model](../../docs/product/specs/domhub-security-threat-model.md)
- [Russia production readiness](../../docs/product/specs/domhub-russia-production-readiness-spec.md)
