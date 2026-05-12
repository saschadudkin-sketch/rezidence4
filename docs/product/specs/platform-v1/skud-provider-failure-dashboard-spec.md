# SKUD Provider Failure Dashboard

Status: Draft / implemented baseline
Scope: `DH-59` provider failure visibility and field rollout evidence

## 1. Purpose

The SKUD hardware registry stores provider configs, mapped devices, integration events and manual-control events. Property operators need one read-only view that shows whether a provider is failing, which hardware boundaries are affected, and whether guards are falling back to manual control.

This module does not change access decisions and does not call vendor systems. It aggregates DomHub evidence for operations and rollout validation, including explicit field rollout evidence rows captured during pilots.

## 2. API

- `GET /api/v1/skud/provider-failures?property_id=<uuid>&window_hours=24&limit=50`
- `POST /api/v1/skud/field-rollout-evidence`

Auth:
- requires an authenticated user;
- requires `hardware.device.read` in the requested property scope;
- accepts `property_id` from query, request property context or current user property.

Response:

```json
{
  "dashboard": {
    "property_id": "uuid",
    "generated_at": "2026-05-11T10:00:00.000Z",
    "window_hours": 24,
    "summary": {
      "providers_total": 1,
      "providers_down": 1,
      "providers_degraded": 0,
      "providers_needing_attention": 1,
      "failed_events": 2,
      "retrying_events": 1,
      "dead_lettered_events": 1,
      "manual_control_events": 4,
      "out_of_service_devices": 1,
      "field_rollout_records": 1
    },
    "providers": [],
    "field_rollout_records": [],
    "field_rollout_evidence": {
      "source_tables": [
        "skud_provider_configs",
        "skud_integration_events",
        "skud_hardware_devices",
        "hardware_manual_control_events",
        "skud_field_rollout_evidence"
      ],
      "evidence_window_hours": 24,
      "returned_provider_configs": 1,
      "active_provider_configs": 1,
      "real_failure_rows": 4,
      "manual_control_event_rows": 4,
      "rollout_evidence_rows": 1,
      "generated_at": "2026-05-11T10:00:00.000Z"
    }
  }
}
```

## 3. Aggregation Rules

Provider rows come from `skud_provider_configs`.
The API returns only operational provider snapshot fields. It must not expose `config_json`, inbound secrets, provider credentials or credential references.

Event summary comes from `skud_integration_events` in the selected window:
- total, succeeded, failed, retrying, dead-lettered, pending/processing and ignored counts;
- last event timestamp;
- last failure timestamp for `failed`, `retrying` or `dead_lettered`.

Top errors are grouped per provider by `error_code`, with `unknown` used when the code is empty. Only failed, retrying and dead-lettered event rows are included.

Device summary comes from `skud_hardware_devices`:
- degraded devices: `status='degraded'` or maintenance status `maintenance/out_of_service`;
- out of service devices;
- manual guard devices: `fallback_rule='manual_guard'` or `fail_safe_mode='manual_guard'`;
- fail closed devices.

Manual-control summary comes from `hardware_manual_control_events` joined to `skud_hardware_devices` in the selected window.

Field rollout records come from `skud_field_rollout_evidence` and can represent provider delivery checks, field drills, rollout reports or vendor health probes for lab, staging, pilot or production rollout stages.

## 4. Frontend

`/v1/admin/skud-provider-failures` is an admin-only page with:
- window selector: 24h, 72h, 7d, 30d;
- KPI tiles for attention, failed events, retry/dead-letter events and manual-control events;
- provider list with health, attention reasons, top errors and hardware/manual summaries;
- field rollout evidence block listing source tables and real failure/manual rows.
- recent field rollout evidence rows when present.

## 5. Acceptance

- The endpoint is property-scoped and read-only.
- Security/admin users with `hardware.device.read` can load the dashboard.
- Cross-property users are rejected by the existing `canInPropertyScope` guard.
- The UI is routed under `/v1/admin/*` and hidden from residents by `RoleGate`.
- Focused backend and frontend tests cover aggregation, route auth and page rendering.
- Admins can record field rollout evidence without calling vendor systems.
