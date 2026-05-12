# Resident Ownership Transfer

Status: Draft / implemented backend baseline
Scope: `DH-55` ownership-transfer workflow and notification preference cascade

## 1. Purpose

Resident offboarding already revokes operational access. Ownership transfer adds the sale/lease-end workflow around that cascade: the previous owner is offboarded, the target resident becomes the active owner for the unit, notification preferences are copied to the new owner and disabled for the previous owner, and lifecycle/audit evidence is written.

This workflow does not replace legal sale documents. It records DomHub operational access changes.

## 2. API

- `POST /api/v1/residents/:id/transfer-ownership`

Body:

```json
{
  "to_resident_id": "uuid",
  "reason": "ownership transfer",
  "effective_at": "2026-05-12T10:00:00.000Z",
  "cascade_notification_preferences": true
}
```

Auth:

- requires property-admin/admin write access for the source resident property;
- rejects a target resident from another property;
- rejects self-transfer.

## 3. Data Model

`v1_047_readiness_live_evidence_and_transfers` adds:

- `resident_ownership_transfers` for property/unit/from/to resident transfer evidence;
- `resident_notification_preferences` for per-resident channel preferences and inherited preference metadata;
- new lifecycle event types `ownership_transferred` and `notification_preferences_cascaded`.

## 4. Cascade

The service:

- copies source resident notification preferences to the target resident before offboarding;
- runs the existing resident offboarding cascade for the previous owner;
- updates the target resident as active `owner` on the transferred unit;
- closes other active owner links for that unit;
- opens/upserts the target owner unit link;
- writes lifecycle events for both residents and sensitive audit evidence.

## 5. Acceptance

- Previous owner access, passes, resident-created access requests, vehicle whitelist state and notification preferences are revoked/disabled.
- Target owner gets the active owner profile and unit link.
- Preference copies preserve channel/event-scope settings and record `inherited_from_resident_id`.
- The response returns transfer, summary and affected rows for operational verification.
