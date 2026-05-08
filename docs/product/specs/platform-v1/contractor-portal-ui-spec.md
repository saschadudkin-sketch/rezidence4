# Module Spec — `contractor_portal_ui` / `/v1/contractor-workspace`

**Status:** Draft

**Backlog:** `DH-30 Contractor Portal UI`

**Dependencies:** `DH-29`

## 1. Purpose

The contractor portal is the restricted external UI for contractor users assigned to service-request work. Staff and concierge teams still triage, assign and review broader request context in `/v1/staff-workspace`; contractors only see the work needed to execute their assignment.

## 2. Route

| Route | Roles | Description |
|---|---|---|
| `/v1/contractor-workspace` | `contractor`, admin roles | Assigned contractor queue, detail, waiting and result submission. |

The `/v1` smart redirect sends `role='contractor'` to `/v1/contractor-workspace`.

## 3. Data Contract

The page uses only `/api/v1/contractor-workspace`:

- `GET /queue` for contractor-scoped assigned work.
- `GET /requests/:id` for limited detail.
- `POST /requests/:id/start`
- `POST /requests/:id/resume`
- `POST /requests/:id/waiting`
- `POST /requests/:id/resolve`

It must not call staff workspace, resident quick-view or generic request mutation APIs.

## 4. UI Scope

- Queue filters: queue, status, priority and free-text search.
- Job detail: category, type, address/target, contractor/company, access expiry, SLA due date, resident-visible request comment and current resolution.
- Actions: start, resume, wait for parts with note, submit resolution note, follow-up flag and result attachment ids.
- Timelines: resident-visible updates and contractor events.
- Attachments: show returned attachments from the restricted contractor detail payload.

## 5. Visibility Rules

- Contractor users do not see internal staff notes, SLA event internals, resident phone/email or resident quick-view data.
- The frontend route guard blocks resident/security/concierge users locally; backend authorization remains the source of truth for queue and detail scope.
- Admin roles may open the route for support, but assignment remains outside this page.

## 6. Acceptance Criteria

- Contractor can open `/v1/contractor-workspace` and see assigned jobs.
- Contractor can start/resume work, mark waiting for parts and submit result output.
- UI uses only contractor workspace APIs.
- Internal staff-only detail is not rendered by the portal.
- Router tests cover contractor redirect/deep-link behavior.
- Page tests cover queue/detail loading, filters, start/resume, waiting, resolve and local denial for non-contractors.

## 7. Deferred

- Dedicated photo upload picker before resolution.
- Contractor company dashboards and completion-quality analytics.
- Physical access policy issuance for contractor work windows.
