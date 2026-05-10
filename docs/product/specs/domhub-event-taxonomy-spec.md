# DomHub — Event Taxonomy Spec

Дата: 2026-05-05
Статус: Draft
Назначение: canonical event taxonomy для audit, analytics, notifications, integrations, release gates and operational reporting.

---

## 1. Context

DomHub events are used by audit logs, notification outbox, analytics aggregation, integration webhooks, incident review and release gates. Without canonical names, the same action becomes multiple incompatible strings across backend, frontend, notifications and external adapters.

This spec defines event naming and minimum envelope. It does not define every payload field for every module; module specs define payload details.

---

## 2. Naming Rules

Event type format:

`domain.entity.action`

Rules:
- Use lowercase ASCII and dots.
- Use past-tense action where the event records a completed fact: `created`, `updated`, `approved`, `denied`, `sent`.
- Use `requested` for user intent before approval.
- Use `failed` only for actual failure, not negative business decisions.
- Do not put tenant names, resident names, phone numbers or vehicle plates in event type.
- Deprecated legacy names may be mapped as aliases, but new code SHOULD emit canonical names.

---

## 3. Event Envelope

Every persisted or emitted operational event SHOULD include:

| Field | Required | Meaning |
|---|---|---|
| `event_id` | yes | Unique event id |
| `event_type` | yes | Canonical taxonomy value |
| `occurred_at` | yes | Server-side timestamp |
| `property_id` | yes for tenant events | Tenant/property scope |
| `actor_type` | where applicable | resident/staff/security/admin/system/integration |
| `actor_id` | where applicable | Actor reference |
| `subject_type` | where applicable | Entity being acted on |
| `subject_id` | where applicable | Subject reference |
| `correlation_id` | recommended | Request/job/workflow correlation |
| `source` | yes | api/job/ui/import/integration/degraded_mode |
| `payload_version` | yes | Payload schema version |
| `sensitivity` | yes | public/internal/sensitive/restricted |

Payloads MUST avoid raw PII when an ID reference is enough.

---

## 4. Canonical Domains

### Platform And Tenant

- `platform.property.created`
- `platform.property.enabled`
- `platform.property.disabled`
- `platform.feature_flag.updated`
- `platform.tenant.provisioned`
- `platform.tenant.migration_started`
- `platform.tenant.migration_completed`
- `platform.tenant.migration_failed`

### Identity And Membership

- `identity.session.created`
- `identity.session.revoked`
- `identity.consent.accepted`
- `identity.consent.revoked`
- `resident.membership.created`
- `resident.membership.updated`
- `resident.membership.suspended`
- `resident.membership.revoked`
- `resident.membership.ended`
- `resident.data_subject_request.created`
- `resident.data_subject_request.fulfilled`

### Access And Checkpoint

- `access.request.created`
- `access.request.approved`
- `access.request.rejected`
- `access.pass.created`
- `access.pass.activated`
- `access.pass.expired`
- `access.pass.revoked`
- `access.qr.verified`
- `access.qr.denied`
- `access.vehicle.verified`
- `access.vehicle.denied`
- `access.visit.entry_allowed`
- `access.visit.entry_denied`
- `access.visit.exit_allowed`
- `access.visit.exit_denied`
- `access.manual_override.created`
- `access.degraded_action.recorded`
- `access.degraded_action.reconciled`
- `access.policy.created`
- `access.policy.updated`
- `access.policy.disabled`
- `access.incident.created`
- `access.incident.resolved`

### Requests And Emergency

- `request.service.created`
- `request.service.updated`
- `request.service.assigned`
- `request.service.status_changed`
- `request.service.comment_added`
- `request.service.resolved`
- `request.service.completed`
- `request.service.cancelled`
- `request.sla.breached`
- `request.emergency.created`
- `request.emergency.escalated`
- `request.emergency.resolved`

### Communications And Content

- `announcement.published`
- `announcement.updated`
- `document.published`
- `document.updated`
- `notification.queued`
- `notification.sent`
- `notification.failed`
- `package.arrived`
- `package.picked_up`

### Integrations And Hardware

- `integration.provider.configured`
- `integration.provider.disabled`
- `integration.delivery.queued`
- `integration.delivery.sent`
- `integration.delivery.failed`
- `integration.sync.started`
- `integration.sync.completed`
- `integration.sync.failed`
- `integration.erp.import.previewed`
- `integration.erp.import.applied`
- `integration.erp.export.generated`
- `hardware.device.created`
- `hardware.device.updated`
- `hardware.device.health_changed`
- `video.evidence.linked`
- `video.evidence.viewed`
- `video.provider.configured`
- `video.camera_provider.linked`

### Audit And Review

- `audit.sensitive_action.recorded`
- `audit.access_review.created`
- `audit.access_review.completed`
- `audit.export.created`

---

## 5. Sensitive Action Taxonomy

Sensitive-action review is the DH-08/DH-60 bridge: DH-08 defines which audit actions are reviewable from persisted data; DH-60 later adds full anti-abuse review workflows.

Backend baseline:
- catalog: `backend/src/v1/services/auditEventCatalog.js`;
- report API: `GET /api/v1/audit/sensitive-actions`;
- metadata API: `GET /api/v1/audit/sensitive-actions/_meta`.

Sensitive categories:

| Category | Examples | Why reviewable |
|---|---|---|
| `manual_override` | `override.created` | guard/admin bypass of automatic policy |
| `access_grant` | `access_request.approved`, `pass.created`, `pass.unblocked` | creates or restores access |
| `access_restriction` | `pass.revoked`, `pass.blocked` | removes or limits access |
| `access_decision` | `access_request.rejected`, `access_request.escalated` | resident/security dispute context |
| `incident_review` | `incident.resolved`, `incident.dismissed`, `incident.patched` | closes or changes an incident |
| `vehicle_decision` | `vehicle.whitelisted`, `vehicle.blacklisted`, `vehicle.flags_cleared` | affects barrier/LPR access |
| `permission_change` | `staff.created`, `staff.updated`, `staff.deactivated` | changes operational permissions |
| `contractor_access` | `contractor_user.created`, `contractor_user.updated`, `contractor_user.deactivated` | grants or removes contractor access |
| `access_boundary` | `access_zone.updated`, `access_point.updated` | changes policy/checkpoint boundaries |
| `hardware_boundary` | `access_point.created`, `access_point.deactivated` | changes physical checkpoint routing |
| `personal_data` | `resident.updated`, `resident.deactivated`, `resident.consent_given` | touches PII/lifecycle controls |
| `provider_settings` | `integration.provider.configured`, `integration.provider.disabled` | changes external source behavior |
| `data_import` | `erp.import.previewed`, `erp.import.applied` | can expose or change external-ID mappings for resident/staff/property data |
| `video_evidence` | `video.evidence.viewed`, `video.evidence.linked`, `video.provider.configured`, `video.camera_provider.linked` | privacy-sensitive evidence access and camera/provider mapping |
| `export` | `audit.export.created`, `erp.export.generated` | can expose sensitive operational data |

Known legacy action strings MAY remain in `property_audit_log.action`; the catalog maps them to canonical event names for review/reporting without rewriting old rows.

---

## 6. Review API Contract

`GET /api/v1/audit/sensitive-actions`

Role: `property_admin`, `management_company_admin`, `platform_admin` through `audit.read`.

Query parameters:
- `category` optional sensitive category from `_meta`;
- `property_id` optional UUID filter for mixed/property-aware stores;
- `actor_uid` optional actor filter;
- `resource_type` optional resource filter;
- `from`, `to` optional ISO timestamps;
- `limit`, `offset` pagination.

Response:

```ts
type SensitiveActionReviewResponse = {
  actions: Array<{
    id: string;
    property_id: string | null;
    actor_uid: string | null;
    actor_role: string | null;
    actor_type: string | null;
    action: string;
    canonical_event_type: string;
    category: string;
    sensitivity: 'sensitive' | 'restricted';
    review_required: true;
    review_reason: string;
    resource_type: string;
    resource_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    changes: object | null;
    ip_address: string | null;
    created_at: string;
  }>;
  page: { limit: number; offset: number; returned: number; hasMore: boolean };
};
```

`GET /api/v1/audit/sensitive-actions/_meta`

Returns available `categories` and source audit `actions`.

---

## 7. Legacy Alias Map

Older platform-v1 notification specs mention event-like names. New code SHOULD emit canonical names while adapters MAY accept aliases:

| Legacy / older name | Canonical event |
|---|---|
| `guest.arrived` | `access.visit.entry_allowed` |
| `request.approved` | `access.request.approved` or `request.service.status_changed` depending domain |
| `request.rejected` | `access.request.rejected` or `request.service.status_changed` depending domain |
| `announcement.published` | `announcement.published` |
| `blacklist.attempt` | `access.incident.created` |
| `package.arrived` | `package.arrived` |
| `booking.confirmed` | module-specific expansion event |
| `meter.reminder` | module-specific expansion event |
| `billing.overdue` | module-specific expansion event |

---

## 8. Acceptance Criteria

- Given a new audit/integration/analytics event is added, when it is named, then it follows `domain.entity.action`.
- Given a notification producer emits an event, when it crosses an outbox/webhook boundary, then it includes the required envelope fields.
- Given an event includes sensitive context, when payload is built, then raw PII is avoided unless explicitly required and classified.
- Given a legacy alias is consumed, when the event is processed, then it maps to a canonical event or remains module-specific with documented reason.
- Given a property admin requests sensitive-action review, when audit rows exist with known sensitive actions, then the response includes canonical event type, category, sensitivity and review reason.
- Given a non-admin security user requests sensitive-action review, when authorization runs, then the request is denied.

---

## 9. Out Of Scope

- Full OpenAPI event payload schemas.
- Vendor-specific event vocabularies.
- BI warehouse schema.
- Module-specific expansion events until the module is enabled.
- Full DH-60 review assignment/attestation workflow.
