# DomHub — Security Threat Model

Дата: 2026-05-05
Статус: Draft
Назначение: зафиксировать основные security/privacy threats для DomHub и минимальные controls, которые должны учитываться в архитектуре, backlog, тестах и release gates.

---

## 1. Context

DomHub управляет закрытыми жилыми территориями, доступом, КПП, заявками, жителями, автомобилями, подрядчиками, документами и интеграциями. Главные риски продукта связаны не только с классическими web-уязвимостями, но и с tenant isolation, ПДн, злоупотреблениями персонала, ручными решениями охраны, интеграциями с оборудованием и видео evidence.

Этот threat model опирается на:
- `domhub-final-product-plan.md`;
- `domhub-russia-production-readiness-spec.md`;
- `domhub-access-data-model-spec.md`;
- `domhub-access-policy-spec.md`;
- `domhub-test-strategy-spec.md`;
- `domhub-integration-architecture-spec.md`.

Документ не заменяет внешний аудит ИБ или юридическую оценку ПДн. Он задаёт минимальный продуктово-инженерный baseline.

---

## 2. Assets

- Tenant/property data boundaries.
- Resident profiles, phones, memberships, household links and notification channels.
- Vehicle plates and vehicle-to-resident/home links.
- Access requests, passes, QR tokens, visit logs and manual overrides.
- Staff, contractor and admin permissions.
- Request history, emergency requests, SLA and escalation data.
- Documents, announcements, OSS/GIS-ready export packages.
- Integration credentials, provider configs, SKUD/barrier/intercom/LPR/camera mappings.
- Video evidence references and incident records.
- Audit events and sensitive-action reports.

---

## 3. Trust Boundaries

- Browser/mobile client -> `/api/v1/*`.
- Public pass page -> limited pass verification surface.
- Resident/staff/security/admin roles -> role + scope enforcement.
- Property tenant -> platform registry/control plane.
- DomHub -> notification providers.
- DomHub -> SKUD/video/ERP/1C/GIS-ready integrations.
- Online checkpoint flow -> degraded/offline checkpoint procedure.
- Support/operator access -> tenant data and audit review.

---

## 4. Threats And Required Controls

### T1 Tenant Data Leakage

Threat: user from one property sees residents, requests, passes, vehicles, documents or analytics from another property.

Controls:
- Every persisted operational entity MUST be scoped by `property_id` or a parent tenant boundary.
- APIs MUST resolve tenant context before business logic.
- Cross-property views MUST be limited to `management_company_admin` scope.
- Tests MUST include negative cross-tenant access cases.

### T2 Broken Role/Scope Authorization

Threat: resident/security/contractor/staff/admin role gets broader data or actions than intended.

Controls:
- Role alone MUST NOT be sufficient; permissions require role + property + scope + action.
- Sensitive fields SHOULD be masked by default outside necessary roles.
- Contractor access MUST be time-bound and assignment-bound.
- Platform admin MUST NOT be used for customer daily operations.

### T3 QR/Pass Abuse

Threat: pass token is guessed, reused, shared after expiry, or accepted at wrong point/time.

Controls:
- Pass tokens MUST be high-entropy and non-enumerable.
- Verification MUST evaluate status, validity window, target zone/point and policy.
- One-shot passes MUST not be accepted after use.
- Denied attempts SHOULD create audit/incident context when policy requires it.

### T4 Vehicle And Plate Abuse

Threat: vehicle plate is linked to wrong resident/home, remains active after sale, or is manually admitted without review.

Controls:
- Vehicle links MUST follow resident lifecycle/offboarding rules.
- Plate search MUST be property-scoped.
- Manual vehicle admit/deny MUST include actor, point, direction and reason.
- Unusual manual vehicle decisions SHOULD be reviewable by property admin.

### T5 Staff/Admin Abuse

Threat: authorized staff misuse legitimate access: export data, grant access, change policy, view evidence or override decisions without reason.

Controls:
- Sensitive actions MUST emit append-only audit events.
- Sensitive-action reports MUST cover grants, policy changes, exports, overrides, video evidence access and provider config changes.
- Periodic access reviews SHOULD be available for staff, contractor, vehicle and policy scopes.

### T6 Personal Data Exposure

Threat: ПДн is over-collected, exposed, exported, retained too long, or processed without traceable basis.

Controls:
- Data categories MUST be classified before production pilots.
- Consent/version history and data subject request flows MUST be implemented for relevant actors.
- Retention/deletion/anonymization procedures MUST be documented and testable.
- Russian data localization assumptions MUST be explicit before production rollout.

### T7 Biometric Scope Creep

Threat: video/camera context quietly becomes face recognition or biometric identity matching.

Controls:
- MVP/v2 Core MUST NOT include biometric identity matching.
- Any biometric module requires separate spec, legal review, consent model, threat model and feature gate.
- Video evidence references MUST NOT be used as biometric identification.

### T8 Integration Desync Or Device Misuse

Threat: SKUD/barrier/intercom/LPR/video/ERP integration silently desyncs, admits incorrectly, or overwrites DomHub source of truth.

Controls:
- Each provider MUST have source-of-truth and fallback rules.
- Integration failures MUST be visible and retryable.
- Device mappings MUST be property-scoped and linked to access points/zones.
- Manual fallback MUST exist before production adapter rollout.

### T9 Degraded Checkpoint Failure

Threat: guard makes decisions during connectivity loss that cannot be reconciled or audited.

Controls:
- Degraded КПП mode MUST record point, direction, actor, reason, known identifiers and reconciliation state.
- Cached lookup data MUST be bounded and treated as potentially stale.
- Reconciliation discrepancies MUST be visible to property admin.

### T10 Audit Tampering

Threat: incident/audit history is edited or deleted to hide abuse.

Controls:
- Audit records MUST be append-only operationally.
- Corrections MUST be represented by new events, not mutation of prior events.
- Audit exports SHOULD include enough metadata for dispute review.

---

## 5. Acceptance Criteria

- Given a resident from property A requests data from property B, when authorization runs, then access is denied and the attempt is test-covered.
- Given a guard manually admits a vehicle, when the action is saved, then audit and visit-log data contain actor, access point, direction and reason.
- Given a staff user exports sensitive data, when export completes, then a sensitive-action event is emitted.
- Given an integration fails, when provider sync retries, then the failure is visible and does not silently change access decisions.
- Given a request for face recognition appears, when scope is evaluated for MVP/v2 Core, then it is rejected unless a separate biometric module exists.
- Given production readiness is reviewed, when release gate checks run, then tenant isolation, sensitive action audit, degraded КПП, DSAR, and no-biometrics controls are represented.

---

## 6. Review Cadence

- Review before every production pilot.
- Review when adding a new role, integration provider, public endpoint, video evidence flow, data export, or biometric-adjacent feature.
- Review during `Russia Production Readiness` gate (`DH-55` through `DH-61`).

---

## 7. Out Of Scope

- Formal certification.
- Penetration test report.
- Vendor-specific SKUD security certification.
- Biometric module threat model.
