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
- Add explicit frontend DTO/types for:
  - `SecurityWorkspaceBootstrap`;
  - `SecurityWorkspaceSearchResult`;
  - `SecurityWorkspaceRecentEvents`;
  - expected guests, blacklist hits, station context and scoped search rows.
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
- Standardize public pass token compatibility before cutover:
  - current public page/route expects 64-hex tokens;
  - current v1 QR generation may issue shorter hex tokens;
  - the cutover must either support both token shapes or migrate v1 token generation to the public-pass token contract.
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
- Public pass link works for already-issued legacy-compatible tokens during the cutover window.
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

- Add explicit `access_requests` fields for product-critical text that appears in guard/public flows:
  - `guest_instructions`;
  - `guard_notes`;
  - future `share_delivery_channels`.
- Use metadata only for experimental or integration-only extensions that are not part of the stable resident/security UX.
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
- Add or reserve explicit feature flags before implementation begins:
  - `trusted_visitors`;
  - `pin_credentials`;
  - `guard_authorized_devices`;
  - `security_workspace_enriched`;
  - `public_pass_v1`.

---

## 6. Additional Competitive Findings

These items were identified after a deeper review of comparable access, resident-app and visitor-management products. They should not interrupt Phases 1-3, but they are strong candidates for the backlog because they appear repeatedly across mature products.

Reviewed public sources:

- Ujin OS: https://ujin.tech/products/ujin-os-platform/
- CtrlHome for УК: https://ctrlhome.app/for-uk
- Domonap: https://domonap.ru/
- ButterflyMX Visitor Passes: https://butterflymx.com/blog/visitor-passes/
- ButterflyMX Delivery Pass: https://butterflymx.com/blog/delivery-pass/
- VisitForm: https://visitform.com/
- EntryZen: https://www.entryzen.com/
- BuildingLink access control: https://www.buildinglink.io/features/building-access-control-system-software
- BuildingLink KeyLink: https://www.buildinglink.io/solutions/additional-features/keylink/
- NoBrokerHood Gatekeeper: https://www.nobrokerhood.com/solutions/gatekeeper-app
- Gatezen: https://gatezen.app/
- Avigilon Alta Visitor: https://www.avigilon.com/alta-visitor
- Condo open-source docs: https://mintlify.wiki/open-condo-software/condo/introduction

### 6.1 Gate-Initiated Resident Approval

Pattern:

- Guard enters visitor details at the gate.
- Resident receives an approve/deny prompt.
- The approval is time-boxed and becomes part of the visit log.

Why it matters:

- This is the missing counterpart to resident-precreated passes.
- It handles real-world walk-ups: taxi, unexpected courier, guest forgot the link, elderly resident did not create a pass.

Suggested DomHub model:

- `POST /api/v1/security-workspace/approval-request`
- `POST /api/v1/resident-access-approvals/:id/approve`
- `POST /api/v1/resident-access-approvals/:id/deny`

Required evidence:

- guard actor;
- resident actor;
- access point;
- visitor label/photo if collected;
- timeout/expired state;
- final visit log or denial incident.

Priority:

- P1 after Phase 3.

### 6.2 Delivery Pass Micro-Flow

Pattern:

- Resident creates a one-time delivery code quickly.
- Code can be pasted into delivery app instructions.
- Entry is logged with time and access point.

Why it matters:

- Delivery is one of the highest-frequency guest-access scenarios.
- It should be faster than full visitor creation.

Suggested DomHub model:

- Add `delivery_pass` preset on top of `pass_type='courier'` or a dedicated `courier` credential profile.
- Generate short-lived single-use PIN or QR.
- Include delivery instructions and allowed access points.
- Support multi-point delivery paths later: gate plus package room, gate plus lobby, gate plus service entrance.

Required guardrails:

- single-use by default;
- short TTL;
- optional grace window;
- no resident phone exposure;
- incident on suspicious repeat attempts.

Priority:

- P1, paired with Phase 5 credential work.

### 6.3 Resident Self-Access Credentials

Pattern:

- Resident access is in the same app as requests, packages, documents and payments.
- Admin can issue/revoke mobile credentials, fobs, cards and PINs.
- Move-in/offboarding drives automatic access grant/revoke.

Why it matters:

- DomHub currently focuses heavily on guest and guard access. Resident/staff credentials are also part of the access product.
- This aligns with resident lifecycle/offboarding requirements already present in the master plan.

Suggested DomHub model:

- Extend the credential layer beyond guest passes:
  - resident mobile credential;
  - staff credential;
  - fob/card external id;
  - resident PIN where legally and operationally acceptable.
- Link credentials to resident lifecycle:
  - move-in activation;
  - ownership/tenancy transfer;
  - offboarding revoke;
  - periodic access review.

Out of scope for first implementation:

- Apple Wallet / Google Wallet production support.
- BLE production support.
- Face recognition.

Priority:

- P2 after pass credential layer is stable.

### 6.4 Video, Intercom And Snapshot Context

Pattern:

- Access events are linked to video/intercom history.
- Guard/admin can see a camera snapshot or call history around a visit.
- Some systems expose camera streams to residents and management.

Why it matters:

- It improves incident review without turning DomHub into a video platform.
- DomHub already has backend video evidence references, camera mapping and SKUD integration specs; the gap is productizing context in guard/admin views.

Suggested DomHub model:

- Add optional `video_context` projection to visit logs by reusing existing video evidence references where possible:
  - provider;
  - camera id;
  - snapshot url;
  - clip reference;
  - retention status.
- Show snapshot/context in guard recent events and incident detail.
- Keep video provider secrets and raw config outside frontend responses.

Priority:

- P2, after Phase 1 guard console upgrade.

### 6.5 Physical Key And Fob Chain Of Custody

Pattern:

- Mature building systems track physical key checkout, key fobs and staff handling.
- Transactions include who took the key, for which unit, when returned, and supporting evidence.

Why it matters:

- Russian residential operations still rely on physical keys, fobs, remotes and cards.
- This is a useful bridge before full digital access integration.

Suggested DomHub model:

- `physical_credentials`
  - key/fob/card/remote;
  - unit/resident/staff/vendor association;
  - status;
  - external tag id;
  - current holder.
- `credential_custody_events`
  - checkout;
  - return;
  - lost;
  - replaced;
  - deactivated.

Privacy/legal note:

- Do not copy biometric checkout patterns by default. Use staff login, signature/photo evidence or admin confirmation first.

Priority:

- P2/P3, valuable for premium and high-control objects.

### 6.6 Emergency / SOS-Linked Access

Pattern:

- Some gated-community products route fire/medical/security alerts to the right people.
- Emergency vehicle access can be tied to an active SOS/emergency record to avoid uncontrolled bypass.

Why it matters:

- DomHub already has emergency dispatch readiness. Access should participate in that flow.

Suggested DomHub model:

- Link `emergency_dispatch` to `access_policy` and `manual_decision`.
- Add emergency access mode:
  - ambulance/fire/police/service vehicle;
  - allowed point/zone;
  - active emergency id required;
  - automatic incident/audit linkage.

Acceptance:

- Emergency access cannot be created without an active emergency record or authorized staff override.
- All emergency admits are visible in access analytics and audit reports.

Priority:

- P1/P2 for pilot hardening.

### 6.7 Away Mode And Contact Routing

Pattern:

- Residents can update contact details, away status or visit preferences.
- Gatehouse staff sees current routing data without using stale spreadsheets.

Why it matters:

- It reduces calls to wrong numbers and makes guard workflows more reliable.
- It is especially useful for cottage communities and premium complexes with staffed КПП.

Suggested DomHub model:

- Add resident access preferences:
  - away mode;
  - preferred contact channel;
  - temporary delegate/contact;
  - visitor auto-deny/auto-review preference within policy limits.
- Expose only guard-safe projections in security workspace.

Priority:

- P2 after gate-initiated approval.

### 6.8 Material In/Out And Move Logistics

Pattern:

- Some residential gatekeeper products handle material in/out, move-in/move-out and service/vendor flows.

Why it matters:

- DomHub already separates access requests and service requests. Material movement is a natural bridge between security and operations.

Suggested DomHub model:

- Add `material_movement_request` or a subtype under service/access link:
  - bring-in / take-out;
  - item description;
  - vehicle;
  - contractor/resident;
  - guard confirmation;
  - photo evidence optional.

Priority:

- P3 unless a pilot object explicitly needs this.

### 6.9 Amenity And Shared-Space Access

Pattern:

- Access systems increasingly control amenities: gyms, lounges, coworking rooms, rooftops, package rooms and parking.

Why it matters:

- DomHub already has legacy bookings/spaces and platform-v1 access topology. The product opportunity is to connect bookings to access credentials.

Suggested DomHub model:

- Booking creates time-limited access credential for a zone/point.
- Access policy enforces booking window.
- Visit log links back to booking id.

Priority:

- P3, after core residential access is stable.

### 6.10 Extension / Mini-App Surface

Pattern:

- Condo emphasizes mini-app extensibility for property-management workflows.

Why it matters:

- DomHub should not build every local workflow directly into core.
- A controlled extension surface would help with local УК-specific processes, vendor integrations and pilot-only features.

Suggested DomHub model:

- Keep out of first access MVP.
- Later define:
  - extension permissions;
  - tenant/property scope;
  - webhook/event contracts;
  - safe UI embedding rules;
  - audit requirements.

Priority:

- P4, platform maturity item.
