# DomHub — Russia Production Readiness Spec

Дата: 2026-05-05
Статус: Draft
Назначение: source-of-truth для требований, без которых DomHub нельзя считать готовым к реальной эксплуатации в России для ЖК, клубных домов и коттеджных посёлков.

---

## 1. Context

DomHub обрабатывает данные жителей, гостей, автомобилей, сотрудников, подрядчиков, заявок, журналов доступа и потенциально связанный видео-контекст. Для российского рынка этого недостаточно описывать только как продуктовые фичи: нужны формальные правила обработки ПДн, жизненный цикл доступа жильцов, аварийные процедуры, готовность к ГИС ЖКХ / ОСС, границы аппаратных интеграций и контроль злоупотреблений персонала.

Этот документ не является юридическим заключением. Он фиксирует продуктовые и инженерные требования, которые должны быть учтены в архитектуре, delivery-планах, acceptance criteria и pilot runbooks.

Нормативные ориентиры для юридического review:
- Федеральный закон №152-ФЗ "О персональных данных";
- требования локализации баз ПДн граждан РФ;
- Постановление Правительства РФ №1119 по уровням защищённости ИСПДн;
- жилищное законодательство и ГИС ЖКХ / ОСС контур для МКД;
- специальные правила для биометрических персональных данных, если продукт когда-либо выйдет за рамки обычного видео-контекста.

---

## 2. Functional Requirements

### FR-1 Resident Lifecycle

DomHub MUST support a formal resident/access lifecycle:
- собственник добавлен;
- житель подтверждён;
- арендатор добавлен на срок;
- представитель / доверенное лицо добавлено;
- доступ приостановлен;
- доступ отозван;
- житель выбыл;
- объект продан / аренда завершена.

Lifecycle change MUST cascade to passes, vehicles, household members, notification preferences and visible resident scope according to policy.

Current backend baseline: resident deactivation cascades to role-scope memberships, resident-unit links, active resident/vehicle passes, pending access requests, vehicle whitelist review markers and notification preferences with lifecycle/audit evidence. Ownership transfer is now a formal workflow over `resident_ownership_transfers`: it offboards the previous owner, activates the new owner link, cascades notification preferences and writes lifecycle/audit evidence.

### FR-2 Ownership And Household Model

DomHub MUST distinguish at least:
- owner;
- resident;
- tenant;
- family_member;
- representative;
- legal_entity_owner;
- property_staff;
- contractor.

For cottage communities, the same model MUST work for a house, plot, townhouse or service unit without apartment-only fields.

### FR-3 Personal Data Compliance Baseline

DomHub MUST have a compliance baseline for:
- operator/processor responsibility model per tenant;
- consent capture and consent history;
- purpose and legal basis registry for stored data categories;
- data retention and deletion/anonymization rules;
- data subject export and deletion request handling;
- audit of access to sensitive personal data;
- data localization assumptions for Russian residents.

Current backend baseline: `/api/v1/privacy/data-subject-requests` records
export/delete/correct/restrict DSAR workflow, `/api/v1/privacy/data-subject-export`
builds a subject export snapshot, `/api/v1/privacy/compliance-evidence` records
retention, localization, ИСПДн and no-biometrics release evidence, and
`/api/v1/privacy/readiness` summarizes DH-56 controls for release review.

### FR-4 Sensitive Data Classification

DomHub MUST classify at least these as sensitive operational data:
- phone numbers and contact channels;
- resident-to-unit/home links;
- vehicle plates and vehicle-to-resident links;
- guest passes and visit logs;
- security manual override history;
- access incidents;
- camera/video evidence references;
- contractor access windows.

Sensitive fields SHOULD be masked by default outside the roles that need them.

### FR-5 Biometrics Guardrail

DomHub MUST NOT include face recognition or biometric identity matching in MVP / v2 Core.

If biometric identification is ever introduced, it MUST be a separate feature-gated module with:
- explicit written consent model;
- separate legal review;
- separate threat model;
- separate retention/deletion rules;
- separate audit and operator responsibility model.

Normal video evidence references are allowed if they are not used for biometric identification.

### FR-6 Emergency Dispatch Mode

DomHub MUST support emergency operational scenarios:
- water leak / flooding;
- heating failure;
- power failure;
- fire/smoke;
- elevator/blocking issue where applicable;
- gate/barrier/checkpoint failure;
- road/territory hazard in cottage communities;
- security incident / suspicious visitor;
- urgent contractor dispatch.

Emergency requests MUST have priority, SLA, escalation and notification behavior distinct from normal requests.

Current baseline: emergency service categories create `emergency_request_profiles` with severity, escalation target, dispatch status, first-response/resolution due timestamps, emergency queue listing, dispatch actions and `request.emergency_created` notification routing. `/api/v1/requests/emergency/readiness`, `/api/v1/requests/emergency/drills`, `/api/v1/requests/emergency/provider-delivery-evidence` and `/v1/admin/emergency-dispatch` add readiness evidence over active queue, on-call roster, provider notification logs, drill records and live provider delivery observations.

### FR-7 Checkpoint Degraded Mode

For checkpoint/guard workflows, DomHub MUST support degraded operation:
- cached lookup for recent/allowed passes and resident vehicles;
- manual admit/deny with mandatory reason;
- manual vehicle/person entry if lookup is unavailable;
- post-fact reconciliation when connectivity returns;
- visible discrepancy report for property admin.

### FR-8 GIS ЖКХ / OSS Readiness

DomHub SHOULD support readiness for ЖК / МКД operations:
- document registry for house/property documents;
- announcements and resident notices export;
- protocol/document storage for owner decisions;
- export package for external ГИС ЖКХ work;
- clear boundary that legally significant OСС voting is not part of MVP unless explicitly approved.

DomHub MUST NOT pretend to be the legally authoritative ГИС ЖКХ channel unless a certified/legal integration is implemented.

### FR-9 Hardware Integration Map

DomHub MUST maintain an integration map for:
- SKUD/access-control systems;
- barriers and gates;
- intercoms;
- license plate recognition;
- cameras/video evidence;
- notification providers;
- ERP/1C/ЖКХ exchange.

Before a verified adapter exists, manual DomHub workflows remain the operational source of truth.

### FR-10 Anti-Abuse And Sensitive Action Audit

DomHub MUST audit and review sensitive actions:
- admin grants access to a resident/staff/contractor;
- security manually admits or denies;
- vehicle is added or linked to a home/unit;
- access policy is changed;
- resident/unit ownership or tenancy is changed;
- sensitive data is exported;
- video evidence is attached or viewed;
- integration secrets or provider settings are changed.

Review workflow MUST support assignment to an active staff reviewer, priority, due date/SLA metadata, sampling of recent sensitive events, overdue/escalated queue states, anti-abuse hotspot reporting and summary reporting before attestation.

DomHub SHOULD provide periodic access reviews and unusual activity reports for property admins and management company admins.

Current baseline: sensitive review assignment/SLA/sampling/escalation and anti-abuse analytics exist. `sensitive_action_report_evidence` records real summary, anti-abuse, escalation, attestation and rollout report evidence for DH-60 validation.

### FR-11 Pilot Operations Runbooks

DomHub MUST provide runbooks for:
- property launch;
- resident import and access activation;
- checkpoint training;
- emergency dispatch;
- degraded КПП mode;
- first-week support;
- incident escalation;
- data correction and resident offboarding.

### FR-12 Incident And Evidence Handling

DomHub MUST support incident evidence handling without becoming a video management system:
- link incident/access event to camera/snapshot/clip references;
- record who viewed or attached evidence;
- support retention policy for evidence references;
- keep incident history append-only at the operational level.

---

## 3. Non-Functional Requirements

- NFR-1: Sensitive operational data MUST follow least-privilege access by role and scope.
- NFR-2: Audit logs for sensitive actions MUST be append-only operationally.
- NFR-3: Checkpoint core workflow SHOULD remain usable during short connectivity loss through degraded mode.
- NFR-4: Russian resident personal data storage assumptions MUST be explicit before production pilots.
- NFR-5: Data export/deletion/anonymization workflows MUST be testable and documented.
- NFR-6: Hardware integrations MUST fail closed or fail visibly; silent desync is not acceptable.
- NFR-7: Emergency request routing MUST be visibly distinct from ordinary service requests.

---

## 4. Acceptance Criteria

- AC-1: Given a resident moves out, when the admin ends their membership, then active passes, vehicle links and resident scope are revoked or marked for review.
- AC-2: Given a vehicle is sold, when the vehicle link is removed, then the plate can no longer be admitted as that resident's vehicle.
- AC-3: Given a guard manually admits a car, when the action is saved, then the visit log includes access point, direction, reason and actor.
- AC-4: Given connectivity is lost at КПП, when the guard uses degraded mode, then the action is stored locally/queued and later reconciled.
- AC-5: Given an emergency request is created, when it enters the queue, then SLA, priority and notification behavior differ from normal requests.
- AC-6: Given a staff user opens sensitive resident data, when access is permitted, then the action can be represented in audit/reporting.
- AC-7: Given a property prepares for launch, when onboarding is complete, then runbooks cover import, resident activation, КПП training and first-week support.
- AC-8: Given a ЖК needs external reporting, when documents/announcements/protocol files are prepared, then DomHub can export or organize them without claiming legal ГИС ЖКХ authority.
- AC-9: Given video evidence is linked to an incident, when the incident is reviewed, then evidence references are visible and evidence access is auditable.
- AC-10: Given a biometric feature request appears, when it is evaluated for MVP/v2 Core, then it is rejected as out of scope unless a separate approved biometric module exists.

---

## 5. Data Model Additions

These models can be implemented directly or mapped to equivalent existing entities.

### `resident_unit_membership`

| Field | Meaning |
|---|---|
| `id` | Membership identifier |
| `property_id` | Tenant/property boundary |
| `unit_id` | Apartment/home/plot/service unit |
| `resident_id` | Linked resident |
| `relationship_type` | owner/resident/tenant/family_member/representative |
| `starts_at` | Access start |
| `ends_at` | Access end if temporary |
| `status` | pending/active/suspended/revoked/ended |
| `ended_reason` | sale/move_out/lease_end/manual/admin_correction |

### `data_consent`

| Field | Meaning |
|---|---|
| `id` | Consent identifier |
| `subject_type` | resident/staff/contractor/guest |
| `subject_id` | Person reference |
| `purpose` | Processing purpose |
| `version` | Consent text version |
| `accepted_at` | Acceptance timestamp |
| `revoked_at` | Revocation timestamp if any |
| `source` | app/admin/import/paper |

### `data_subject_request`

| Field | Meaning |
|---|---|
| `id` | Request identifier |
| `property_id` | Tenant boundary |
| `subject_id` | Person reference |
| `type` | export/delete/correct/restrict |
| `status` | new/in_review/fulfilled/rejected |
| `due_at` | Internal due date |
| `resolution_note` | Result |

### `emergency_request_profile`

| Field | Meaning |
|---|---|
| `request_id` | Linked service request |
| `emergency_type` | water/heating/electric/fire/access/security/territory |
| `severity` | P0/P1/P2 |
| `escalation_target` | Staff/on-call/contractor role |
| `first_response_due_at` | Emergency first response SLA |

### `access_review`

| Field | Meaning |
|---|---|
| `id` | Review identifier |
| `property_id` | Tenant boundary |
| `scope` | resident/staff/contractor/vehicle/policy |
| `period_start` | Review period start |
| `period_end` | Review period end |
| `status` | open/completed/escalated |
| `reviewed_by` | Admin actor |

---

## 6. Edge Cases

- EC-1: Resident has multiple units in one property.
- EC-2: Resident belongs to multiple properties managed by one УК.
- EC-3: Legal entity owns a unit/home and delegates a representative.
- EC-4: Tenant ends lease but still has active guest passes.
- EC-5: Vehicle plate is reused by a different resident after sale.
- EC-6: Guard admits manually during outage and later policy evaluation would deny.
- EC-7: Emergency request is duplicated by several residents.
- EC-8: Video evidence exists in an external VMS but is no longer available at review time.
- EC-9: Import creates residents without verified consent source.
- EC-10: Property wants face recognition before the legal/product module exists.

---

## 7. Out Of Scope For MVP / v2 Core

- Legally significant electronic OСС voting.
- Native ГИС ЖКХ authority or certified filing channel.
- Face recognition / biometric identity verification.
- Full video management system.
- Fully automated SKUD operation without manual fallback.
- Full accounting/billing/payments.
- Advanced AI decisioning over residents, visitors or incidents.
