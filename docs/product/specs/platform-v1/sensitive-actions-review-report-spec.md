# Sensitive Actions Review Report

Status: Draft / implemented baseline
Scope: `DH-60` sensitive-action review UI/report evidence and escalation notification fanout

## 1. Purpose

Sensitive actions already land in `property_audit_log` and are classified through the event taxonomy. `DH-60` adds an operational review layer so property admins can see pending/overdue reviews, anti-abuse hotspots and SLA state without querying the database.

This report is not a replacement for immutable audit logs. It is a review and evidence surface over those logs.

## 2. API

Existing endpoints:

- `GET /api/v1/audit/sensitive-actions/_meta`
- `GET /api/v1/audit/sensitive-actions/_summary?property_id=<uuid>&category=<category>`
- `GET /api/v1/audit/sensitive-actions/_anti-abuse?property_id=<uuid>&category=<category>&window_hours=168&min_actions=5`
- `GET /api/v1/audit/sensitive-actions?property_id=<uuid>&review_status=pending&limit=20`
- `POST /api/v1/audit/sensitive-actions/_sample`
- `POST /api/v1/audit/sensitive-actions/_escalate`
- `GET /api/v1/audit/sensitive-actions/_report-evidence?property_id=<uuid>&report_type=<type>`
- `POST /api/v1/audit/sensitive-actions/_report-evidence`
- `POST /api/v1/audit/sensitive-actions/:id/assign`
- `POST /api/v1/audit/sensitive-actions/:id/review`

Auth:
- requires authenticated `audit.read`;
- current v1 scope is property-admin/admin roles through the existing authz helper.

## 3. Escalation Notification Fanout

`POST /api/v1/audit/sensitive-actions/_escalate` updates overdue `sensitive_action_reviews` rows and inserts `notifications_outbox` rows in the same SQL statement.

Outbox event:

```json
{
  "event_type": "audit.sensitive_review.escalated",
  "channel": "web_push",
  "recipient_type": "staff",
  "recipient_id": "assigned_reviewer_staff_id",
  "payload": {
    "title": "Sensitive action review overdue",
    "body": "Sensitive audit review requires attention",
    "review_id": "uuid",
    "audit_log_id": "uuid",
    "category": "manual_override",
    "action": "override.created",
    "priority": "urgent",
    "escalation_status": "overdue",
    "due_at": "2026-05-11T09:00:00.000Z",
    "url": "/v1/admin/sensitive-actions"
  }
}
```

Notifications are only enqueued when the review has both `property_id` and `assigned_reviewer_staff_id`.

## 4. Live Report Evidence

`sensitive_action_report_evidence` records real DH-60 report validation:

- `summary` for queue/report summary runs;
- `anti_abuse` for hotspot report evidence;
- `escalation` for overdue/escalated review runs;
- `attestation` for completed review evidence;
- `live_rollout` for rollout or pilot acceptance evidence.

Rows store property scope, report type, status, optional reporting period, JSON summary and the generating actor uid.

## 5. Frontend

`/v1/admin/sensitive-actions` shows:
- category filter from `_meta`;
- summary KPIs: total, pending, overdue, urgent/high;
- status/priority breakdown;
- anti-abuse findings for the selected evidence window;
- pending review queue with canonical event type, actor, due date, priority and escalation status.

## 6. Acceptance

- Admin users can deep-link to `/v1/admin/sensitive-actions`.
- Residents are blocked by `RoleGate`.
- The UI loads summary, anti-abuse findings and pending review queue through `/api/v1/audit/*`.
- Escalation writes outbox notification rows without a second non-atomic write path.
- Admin/API workflows can record and list real report evidence through `_report-evidence`.
- Focused backend and frontend tests cover route/service escalation fanout, page rendering and router access.
