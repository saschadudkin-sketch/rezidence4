# Emergency Dispatch Readiness

Status: Draft / implemented baseline
Scope: `DH-57` emergency UI surface, on-call roster/provider evidence and drill records

## 1. Purpose

Emergency request profiles already separate urgent requests from the ordinary service backlog through severity, escalation target, dispatch status and first-response/resolution SLA timestamps. `DH-57` adds an operational readiness surface so property admins can verify current emergency queue state, active on-call coverage, notification evidence and drill records without querying the database.

This is not a dispatch-center telephony integration. External provider certification and live 24/7 support validation remain rollout work, but DomHub now has a durable place to record provider delivery observations from real drills.

## 2. API

Endpoints:

- `GET /api/v1/requests/emergency/queue?status=&severity=&limit=`
- `POST /api/v1/requests/:id/emergency-dispatch`
- `GET /api/v1/requests/emergency/readiness?property_id=<uuid>&window_hours=72&limit=25`
- `POST /api/v1/requests/emergency/drills`
- `POST /api/v1/requests/emergency/provider-delivery-evidence`

Auth:

- requires an authenticated staff/admin role allowed to manage emergency requests;
- residents are blocked by the emergency service guard.

`/emergency/readiness` returns:

- summary KPIs for active emergencies, P0 rows, overdue response/resolution and notification success/failure counts;
- active emergency queue rows joined to request context;
- active `emergency_on_call_rosters` rows;
- provider notification evidence over `notification_log` for `request.emergency_created`;
- recent `emergency_dispatch_drills`;
- live provider delivery evidence over `emergency_provider_delivery_evidence`;
- source-table evidence metadata.

`/emergency/drills` records an operational drill with scenario type, severity, escalation target, status, summary, findings and notification evidence metadata.

`/emergency/provider-delivery-evidence` records live provider/channel delivery observations with provider, channel, scenario type, status, latency, optional request/drill linkage and external delivery id.

## 3. Data Model

`v1_043_emergency_dispatch_mode` owns request-level runtime state in `emergency_request_profiles`.

`v1_046_emergency_readiness_evidence` adds:

- `emergency_on_call_rosters` for active duty coverage by escalation target and provider/channel reference;
- `emergency_dispatch_drills` for operational drill records, optional request linkage, findings and notification evidence.

`v1_047_readiness_live_evidence_and_transfers` adds:

- `emergency_provider_delivery_evidence` for provider delivery observations captured during live drills or rollout checks.

Provider secrets are not stored in either table. `contact_ref` is an operational reference, not a credential.

## 4. Frontend

`/v1/admin/emergency-dispatch` shows:

- emergency KPIs;
- active emergency queue with SLA due dates and notification status;
- active on-call roster;
- provider notification evidence by channel/status;
- drill recording form;
- recent drill records;
- live provider delivery evidence;
- evidence source tables and generated timestamp.

The page requires a selected property context. Without one, it renders a property-binding warning and does not call the readiness API.

## 5. Acceptance

- Admin users can deep-link to `/v1/admin/emergency-dispatch`.
- The UI loads readiness evidence through `/api/v1/requests/emergency/readiness`.
- Admins can record a drill through `/api/v1/requests/emergency/drills`.
- Admins can record provider delivery observations through `/api/v1/requests/emergency/provider-delivery-evidence`.
- Backend service aggregation stays outside the route layer.
- Focused backend and frontend tests cover migration shape, service aggregation, route behavior, page rendering, drill submission and router access.
- Remaining DH-57 work stays explicit: external certification and production 24/7 support validation.
