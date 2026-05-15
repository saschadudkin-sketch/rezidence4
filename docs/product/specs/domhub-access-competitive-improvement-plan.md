# DomHub Access Competitive Improvement Plan

Дата: 2026-05-15  
Статус: зафиксированный execution plan  
Область: access-platform, resident pass UX, guard console, public pass, SKUD readiness  
Основано на: `domhub-final-product-plan.md`, `domhub-access-platform-final-plan.md`, `ACCESS_SOURCE_OF_TRUTH.md`

---

## 1. Цель

Закрыть разрыв между сильной backend-моделью DomHub access-core и ежедневным UX, который ожидают жители, охрана и администраторы в продуктах класса Ujin, CtrlHome, ButterflyMX, VisitForm, GoAccess и EntryZen.

Целевое состояние:

- resident быстро создаёт понятный пропуск;
- гость получает рабочую публичную ссылку, QR и позднее PIN/fallback credential;
- security видит контекст КПП, ожидаемых гостей, последние события, blacklist hits и инструкции;
- property admin управляет пропусками, точками доступа, правилами, инцидентами и сбоями СКУД;
- все access decisions остаются tenant-scoped, аудируемыми и совместимыми с platform-v1.

---

## 2. Product Principles

- `/api/v1/*` остаётся source of truth. Deprecated `/api/*` and legacy pass/request tables are compatibility only.
- Initial hydrate and incremental updates stay separate: guard console hydrates via `security-workspace`, SSE only applies incremental updates.
- Public guest-pass surface must not expose resident UID, internal staff notes, resident phone, or sensitive tenant data.
- QR/plate/PIN are credentials for the same `pass` lifecycle, not separate business entities.
- No face recognition or biometric identity matching without separate legal/product approval.
- Hardware/manual-control features must preserve reason, actor, device, access point, incident/audit linkage, and degraded-mode reconciliation.

---

## 3. Phased Plan

### Phase 0 - Spec Alignment

Purpose: make the competitive improvements explicit in product source-of-truth documents before implementation.

Scope:

- Update or cross-link:
  - `platform-v1/access-requests-spec.md`
  - `platform-v1/passes-spec.md`
  - `platform-v1/security-workspace-spec.md`
  - this document
- Add explicit product vocabulary:
  - trusted visitors / frequent guests;
  - pass credentials: QR, PIN, plate, later wallet;
  - guest instructions and guard notes;
  - guard authorized devices;
  - v1 public pass page.

Out of scope:

- Wallet passes.
- Face/BLE production support.
- Direct hardware open commands beyond existing audited manual-control boundaries.

Acceptance:

- New work items reference this plan or a more detailed module spec.
- New access UX work does not target legacy `/api/*` aliases as canonical contracts.

---

### Phase 1 - Guard Console Uses Security Workspace API

Purpose: expose backend capabilities that already exist.

Backend source:

- `GET /api/v1/security-workspace/bootstrap`
- `GET /api/v1/security-workspace/search`
- `GET /api/v1/security-workspace/recent-events`
- `POST /api/v1/security-workspace/manual-decision`
- `POST /api/v1/security-workspace/offline-replay`

Frontend work:

- Extend `frontend/src/v1/api/securityWorkspace.ts` with:
  - `bootstrap()`;
  - `search()`;
  - `recentEvents()`.
- Upgrade `frontend/src/v1/pages/GuardConsolePage.tsx`:
  - expected guests/arrivals panel;
  - recent events panel;
  - open incidents / blacklist hits panel;
  - unified search across vehicles, residents, units and passes;
  - access point scoped hydrate/search where relevant.
- Keep `ScanPanel` as the action center, but show station context and offline queue status alongside scan/manual-decision controls.

Acceptance:

- Security/admin can hydrate guard console from `security-workspace/bootstrap`.
- Search is vehicle-first but includes resident, unit and pass results.
- Access point selection scopes expected guests, active passes and recent events.
- Manual decisions and offline replay remain auditable.

Checks:

- `backend/src/__tests__/v1SecurityWorkspaceRoutes.test.js`
- focused GuardConsole frontend tests
- `e2e/v1-access-production.spec.js`

---

### Phase 2 - Public Pass v1 Cutover

Purpose: make the shareable guest-pass experience use platform-v1 entities.

Current gap:

- `backend/src/routes/publicPass.js` reads legacy `qr_passes` and `requests`.
- `frontend/src/views/public/GuestPassPage.tsx` is product-relevant, but its backend source is not v1.

Backend work:

- Move public lookup to `qr_passes_v2`, `passes`, `access_requests`, `vehicles`, `access_points`.
- Preserve rate limiting and unauthenticated access.
- Return only public-safe fields:
  - pass status;
  - visitor label;
  - property display name;
  - destination label;
  - valid window;
  - pass type;
  - optional access point/zone display;
  - guest-facing instructions.

Frontend work:

- Render v1 status: active, used, expired, revoked, blocked.
- Show QR, validity, access point/entry guidance and guest instructions.
- Prepare layout for future PIN/fallback credential without exposing it before the backend supports policy-controlled PIN.

Acceptance:

- Public pass link works for v1 QR tokens.
- Legacy route compatibility is preserved or explicitly shimmed.
- Public response excludes resident UID, internal notes and sensitive staff data.

Checks:

- backend public-pass route tests
- frontend public pass smoke tests
- rate-limit/security regression tests

---

### Phase 3 - Resident Pass Creation UX

Purpose: make pass creation feel like a pass product, not a generic request form.

Frontend work:

- Extend `AccessRequestForm` with:
  - visit type presets: guest, courier, service, vehicle;
  - fast time windows: today, tomorrow, 2 hours, until end of day;
  - optional guest instructions;
  - staff/security-only guard notes;
  - access point/zone selection when property topology exists;
  - "create similar" flow after success.
- After approval or auto-approval, surface the share link `/p/:token`.
- Add resident-visible revoke/cancel affordance where state machine allows it.

Backend work:

- Add or standardize fields through `access_requests.metadata` or explicit columns:
  - `guest_instructions`;
  - `guard_notes`;
  - future `share_delivery_channels`.
- Include these fields in security workspace feeds with role-safe visibility.

Acceptance:

- Resident can create guest/courier/service/vehicle access without knowing backend request types.
- Guard sees only operational notes relevant to admission decisions.
- Guest-facing instructions are visible on public pass.

Checks:

- access request service tests
- access request route tests
- ResidentAccessPage and AccessRequestForm tests

---

### Phase 4 - Trusted Visitors / Frequent Guests

Purpose: support cleaners, relatives, recurring service providers and common visitors without a full calendar engine.

New entity:

```text
trusted_visitors
  id
  property_id
  resident_id
  name
  phone
  visitor_type
  default_vehicle_plate
  default_instructions
  allowed_zone_id
  allowed_point_id
  is_active
  last_used_at
  created_at
  updated_at
```

API:

- `GET /api/v1/trusted-visitors`
- `POST /api/v1/trusted-visitors`
- `PATCH /api/v1/trusted-visitors/:id`
- `POST /api/v1/trusted-visitors/:id/create-pass`
- `POST /api/v1/trusted-visitors/:id/deactivate`

Frontend:

- Resident tab: frequent guests.
- Create pass from trusted visitor in one or two clicks.
- Show recent visit history for that visitor.

Acceptance:

- Trusted visitors are resident-owned and property-scoped.
- Deactivation prevents future pass creation but does not rewrite historical visit logs.
- Creating a pass from a trusted visitor still produces a normal audited `access_request` / `pass`.

Checks:

- service tests
- route auth tests
- resident UI smoke tests

---

### Phase 5 - Pass Credential Layer

Purpose: support QR, PIN and plate as credentials for one pass lifecycle.

Candidate model:

```text
pass_credentials
  id
  property_id
  pass_id
  credential_type  -- qr | pin | plate
  token            -- QR/public token when applicable
  credential_hash  -- PIN or secret credential hash
  render_version
  expires_at
  used_at
  revoked_at
  created_at
  updated_at
```

Backend work:

- Keep `passes` as the business entity.
- Treat `qr_passes_v2` as compatibility or migrate into `pass_credentials`.
- Add `mode='pin'` to verification only after PIN hashing, rate limiting and audit are defined.
- Preserve hard-deny cascade in `verifyPass`: invalid, blacklist, revoked, blocked, used, expired, outside window, policy decision.

Frontend work:

- Add PIN mode to guard scan panel when feature flag is enabled.
- Show PIN on public pass only when policy allows it.

Acceptance:

- Revoking/blocking a pass invalidates all credentials.
- Regenerating QR/PIN is auditable and invalidates old credential material.
- PIN attempts are rate-limited and create visit/incident evidence on suspicious use.

Checks:

- pass service tests
- verify pass orchestration tests
- route tests for PIN credential security

---

### Phase 6 - Admin Pass Management

Purpose: give property admins a product-grade active-pass management surface.

Frontend work:

- Add active pass management to `AccessAdminPage`:
  - visitor/pass label;
  - resident/unit;
  - type;
  - validity;
  - access point/zone;
  - credential types;
  - status;
  - revoke/deactivate;
  - internal notes.

Backend work:

- Enrich `/api/v1/passes` list response or add a purpose-built read model:
  - resident name;
  - unit label;
  - vehicle plate;
  - access point/zone labels;
  - linked request;
  - credential type summary.

Acceptance:

- Admin can quickly find and revoke active guest/vehicle/service passes.
- List is property-scoped and does not leak cross-tenant data.
- Sensitive notes remain staff/admin only.

Checks:

- passes route tests
- AccessAdminPage tests
- OpenAPI drift tests if response shape changes

---

### Phase 7 - Guard Authorized Devices

Purpose: reduce risk from shared/stolen security accounts and support checkpoint operations.

New entity:

```text
guard_authorized_devices
  id
  property_id
  access_point_id
  staff_user_id
  device_fingerprint
  label
  status
  last_seen_at
  revoked_at
  created_at
  updated_at
```

Backend work:

- Device enrollment endpoint for guard console.
- Device check for sensitive guard actions, initially feature-gated:
  - manual admit/deny;
  - offline replay;
  - future hardware manual open.
- Include device id in audit metadata.

Frontend work:

- First-use enrollment prompt for guard console.
- Admin list of authorized checkpoint devices.
- Revoke device flow.

Acceptance:

- Guard actions can be restricted to authorized devices per property/access point.
- Revoked devices cannot execute sensitive guard actions.
- Audit entries include device context when available.

Checks:

- authz tests
- manual decision tests
- security workspace route tests

---

### Phase 8 - Access Analytics And Pilot Hardening

Purpose: make access operations measurable and ready for pilot rollout.

Metrics:

- allow/deny count by access point;
- deny reasons;
- manual override count;
- offline replay count;
- peak traffic windows;
- average verification/decision time where measurable;
- recurring/trusted visitor usage;
- blacklist and suspicious repeat attempts;
- SKUD provider failure/manual-control counts.

Frontend:

- Extend operations dashboard or add access operations dashboard.
- Show property-level and management-company rollups using existing tenant boundaries.

Operational assets:

- Pilot checklist for residents, vehicles, access points and guard training.
- Degraded КПП flow checklist.
- SKUD provider failure evidence checklist.

Acceptance:

- Metrics align with `domhub-analytics-metric-definitions.md`.
- No dashboard metric has a separate hidden formula from backend/service definitions.
- Pilot runbooks reference the same operational flows as the product UI.

Checks:

- analytics aggregation tests
- operations dashboard tests
- release gate checklist update

---

## 4. Recommended Execution Order

1. Phase 1 - Guard Console uses `security-workspace` API.
2. Phase 2 - Public Pass v1 cutover.
3. Phase 3 - Resident pass creation UX and instructions.
4. Phase 4 - Trusted visitors.
5. Phase 5 - PIN/pass credential layer.
6. Phase 6 - Admin pass management.
7. Phase 7 - Guard authorized devices.
8. Phase 8 - Access analytics and pilot hardening.

This order first exposes capabilities already present in the backend, then adds competitive product features without breaking the platform-v1 access model.

---

## 5. Cross-Cutting Requirements

Tenant isolation:

- Every API must resolve property scope through existing v1 property context and `canInPropertyScope` checks.
- Public pass endpoints must lookup only by credential token and return public-safe projections.

Audit:

- Mutations must write `property_audit_log` or existing sensitive action audit where applicable.
- Manual guard decisions must keep reason, actor, access point, degraded state and reconciliation metadata.

Privacy:

- Guest-facing pages must not expose resident internal identifiers, staff-only notes or sensitive contacts.
- Guard/admin views may show operational PII only when needed for access decisions.

Testing:

- Backend route/service tests for every new API or response contract.
- Frontend role-surface tests for resident, security and admin flows.
- E2E coverage for guest access and vehicle access critical paths.
- OpenAPI drift checks when route contracts change.

Feature gating:

- PIN credential, guard authorized devices and enriched admin pass management should be feature-gated until route, UI and audit coverage are complete.

