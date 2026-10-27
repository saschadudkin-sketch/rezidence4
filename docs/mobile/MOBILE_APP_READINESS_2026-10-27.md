# Mobile app readiness audit — 2026-10-27

## Scope and confidence

This is a repository-level static audit based on the checked-in source and documentation. It is **not** a runtime certification: no production environment, resident accounts, SMS provider, access-control hardware, Apple signing account, or Android signing key was used. No production data was accessed.

## Findings

### Confirmed from repository files

- The repository has an existing React + TypeScript + Vite frontend in `frontend/package.json`.
- The backend is Node.js + Express, with PostgreSQL and Redis described in `README.md`, `backend/package.json`, and `docker-compose.yml`.
- The repository documents versioned product endpoints under `/api/v1/*`; `docs/openapi.json` is the route contract inventory.
- Existing modules are documented for OTP authentication, access requests, passes, verification, access zones/points/policies, vehicles, guard/security workspace, resident/unit lifecycle, and operations/admin readiness.
- Existing PWA-related dependencies are present in the frontend package: Workbox and `vite-plugin-pwa`.
- No `apps/mobile`, Expo app, React Native app, or EAS configuration was present at the repository root when this audit was prepared.
- The authentication route `backend/src/routes/auth.js` sets HTTP-only access and refresh cookies. The OTP verification flow returns a user payload; the route must be reviewed end-to-end before treating it as a supported native-mobile token contract.
- Existing project documents already describe security, access-control, Russia production readiness, API contracts, release gates, and test strategy. New work must align with those source-of-truth documents instead of inventing parallel access semantics.

### Not yet verified

- Whether the current default branch passes all backend tests, strict verification, end-to-end tests, and a production build today.
- Whether live deployment environment variables and TLS are configured correctly.
- Whether the SMS provider is configured for production (the example environment file uses `SMSRU_API_ID=STUB` as a placeholder).
- Whether all listed access workflows work against a clean, real PostgreSQL instance.
- Which access-control/СКУД vendor, controller model, protocol, API, or test sandbox is available.
- Whether the operator has the Apple Developer / Apple Business Manager arrangements needed for closed iOS distribution and the Android signing/release credentials.

## Blocking decisions before a native release

1. **Native authentication contract.** Define a secure mobile session contract for the native client. Do not rely on platform-dependent cookie behavior or put long-lived secrets in the app bundle. Keep the current web session flow compatible.
2. **API base URL and tenant context.** Specify how the mobile app discovers the correct production API and property context. Never accept an arbitrary tenant/database URL from a client.
3. **Pass and QR contract.** Use the existing access API and server-side policy engine. The client must not make final access decisions locally.
4. **Push notifications.** Select and configure a supported provider, store device tokens securely, and define opt-in, logout, and device-revocation behavior.
5. **СКУД integration.** Obtain vendor/model/API documentation and test credentials. Until then, integration can only be implemented behind an adapter and validated against a mock/sandbox.
6. **Russian personal-data compliance.** Confirm operator/processor responsibilities, Russian data-localization requirements, retention, consent/legal basis, incident handling, and hosting region with the responsible organization and legal counsel.
7. **Closed distribution.** Decide Android distribution and the appropriate Apple distribution method. TestFlight is a testing channel, not a permanent substitute for an agreed resident rollout model.

## Recommended sequence

1. Run repository checks in an isolated environment and record current baseline results.
2. Implement a versioned native authentication/session contract with tests, preserving the web cookie flow.
3. Add a native mobile app under `apps/mobile` using TypeScript and Expo only after choosing the supported API contract.
4. Implement resident pass flows using existing `/api/v1/*` contracts; no duplicated policy logic.
5. Implement guarded scan/manual verification with server-side decisions and auditable outcomes.
6. Add device registration and push notifications after provider configuration.
7. Add hardware integration only after vendor API and sandbox are available.
8. Complete security, accessibility, device, release, backup-restore, and operational acceptance tests before pilot use.

## Release rule

Do not describe the app as production-ready until the automated checks pass, mobile authentication is verified on physical iOS and Android devices, real SMS/push configuration is tested, the tenant isolation/security tests pass, and the responsible operator signs off on data protection and operational procedures.
