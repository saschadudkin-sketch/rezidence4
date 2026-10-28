# Native mobile implementation plan — Резиденции Замоскворечья

## Product outcome

A single residential access platform with three role experiences:

- **Resident:** create, view, share, and revoke guest/delivery/service passes; receive status updates and service notifications.
- **Guard:** scan QR, perform manual lookup, see a clear server-issued decision, record the result, and follow a documented degraded-network procedure.
- **Administration:** manage resident/unit associations, staff roles, access policies, pass lifecycle, incidents, audit evidence, and integration configuration.

The existing web frontend remains the operational/admin experience unless the audit proves a specific screen must move. Native mobile should not create a second source of truth.

## Architecture

- Native app: React Native + Expo + TypeScript.
- Routing: Expo Router.
- API: existing versioned `/api/v1/*` contract, with a documented native session contract added before production login.
- Server: existing Express backend and PostgreSQL/Redis; access policy decisions stay server-side.
- Secure device storage: platform secure storage for native session material; never embed server secrets in the app.
- Builds: EAS Build or a documented equivalent after bundle identifiers, signing ownership, and distribution route are chosen.
- Tests: unit tests for mobile domain/UI logic, API contract tests, end-to-end flows on Android/iOS, plus backend security and tenant-isolation tests.

## Functional milestones

### M0 — Baseline and contract
- Record current CI/build/test state without production credentials.
- Confirm OTP request/verification contract, refresh, logout, revocation, role claims, tenant context, error shape, and session expiry.
- Add a native auth flow without breaking browser cookie sessions.
- Acceptance: native auth tests prove successful login, invalid/expired OTP, rate limiting, refresh rotation, logout, revoked session, and role enforcement.

### M1 — Resident MVP
- Home screen with a single primary action: create pass.
- Pass types must come from the current backend contract/policy, not client-invented enums.
- Create pass with visitor details, validity window, optional vehicle data, and server-side validation.
- Active/history lists; details; share-safe pass link/QR; cancel/revoke.
- Acceptance: a resident cannot read or mutate another resident's passes by changing IDs; revoked and expired passes cannot authorize entry.

### M2 — Guard workspace
- Camera permission and QR scanner.
- Manual fallback by pass code or approved search fields.
- Decision states: valid, expired, revoked, already used/limit reached, not found, policy denied, and service unavailable.
- Every check uses the server decision endpoint and writes a traceable event.
- Acceptance: duplicate scan/replay and race conditions are handled server-side; offline mode never displays an unverified QR as authorized.

### M3 — Administration and staff
- Reuse the existing web admin and guard workspace where possible.
- Mobile staff view is optional and only added for workflows that benefit from a phone.
- Role and property scope enforced server-side on every mutation.

### M4 — Notifications and integrations
- Configure push provider and device registration/revocation.
- Add SKUD integration through a vendor-specific adapter.
- Start with a mock adapter; do not issue commands to live doors/gates until vendor, authorization, test environment, fail-safe behavior, and operator approval are documented.

### M5 — Release hardening
- Accessibility and small-screen checks.
- Android/iOS physical-device tests, network loss, expired session, time-zone changes, deep links, QR replay, account offboarding, and push opt-out.
- Backup/restore drill, monitoring/alerts, privacy and retention review, support runbook, release rollback plan.
- Pilot with test accounts before any real resident data is enabled.

## Security requirements

- Authorization and property scoping are enforced on the backend, never only in the UI.
- QR payloads contain no phone numbers, apartment identifiers, or other personal data.
- Use opaque, high-entropy pass tokens; store only a hash where compatible with the existing pass model.
- Apply expiry, revocation, replay/use-limit checks, rate limiting, and idempotency on the server.
- Minimize personal data, mask it in staff views where practical, and keep audit events append-only or otherwise tamper-evident.
- Never log OTP values, raw refresh tokens, QR bearer tokens, or full sensitive payloads.
- Keep all signing credentials and API secrets outside source control and the mobile bundle.
- On connectivity loss, do not make a client-side authorization decision. Use a documented manual exception process and record it for later reconciliation.
- No biometrics or face recognition without a separate approved specification and legal review.

## Distribution constraints

- Android: signed APK for controlled pilot or a managed distribution channel; document how updates and signing-key recovery work.
- iOS: TestFlight for testing; for resident production distribution, confirm Custom Apps/Apple Business Manager eligibility or another Apple-approved route. Do not use the Apple Enterprise program to distribute to residents.
- The app is not released until install, update, revoke, and support flows have been exercised on real devices.

## Definition of done

A milestone is done only when code, tests, API contract, operator instructions, and evidence are committed. A green build alone is not proof that the whole access system is safe for production.
