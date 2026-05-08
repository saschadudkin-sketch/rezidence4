# DomHub — UI Screen Map

Дата: 2026-05-05
Статус: Draft
Назначение: role-by-role карта экранов DomHub, чтобы frontend, product and design не расходились в навигации и scope.

---

## 1. Context

DomHub has multiple role-specific experiences: resident, security, concierge, technician, contractor, property admin, management company admin and platform admin. The product must stay operational and focused: resident UI stays simple, staff/admin UI can be deeper, and cottage-community mode must not leak apartment-only terminology.

This map links product scope to UI surfaces. It is not a pixel-level design spec and does not replace Figma/design system docs.

---

## 2. Global UI Rules

- UI MUST be property-type-aware for `residential_complex`, `club_house` and `cottage_community`.
- Cottage-community screens MUST use house/plot/sector/checkpoint labels where applicable.
- Sensitive fields SHOULD be masked unless the role/action needs them.
- Emergency states MUST be visually distinct from ordinary backlog states.
- Guard/checkpoint screens MUST optimize for low-click operation.
- Platform admin screens MUST NOT become daily customer operations screens.

---

## 3. Resident Screens

Core:
- Login / session restore.
- Home / overview.
- Profile and notification preferences.
- My home/unit membership view.
- Guest pass creation.
- Vehicle access view.
- Pass status and QR/public pass access.
- Service request creation.
- Request history and detail.
- Announcements.
- Documents.
- Notification center.
- Package status where enabled.

Russia readiness:
- Consent/version acknowledgement where required.
- Data request entry point where enabled.
- Membership/offboarding state where visible to resident.

Out of scope:
- Staff assignment details.
- Internal comments.
- Cross-property admin data.

---

## 4. Security / Guard Screens

Core:
- Guard console.
- QR scan.
- Plate lookup.
- Checkpoint/access-point selector.
- Entry/exit mode.
- Admit/deny/manual override.
- Recent visit events.
- Incident launch.

Cottage-community priority:
- Vehicle-first default mode.
- КПП/gate/barrier terminology.
- Home/plot/resident context after plate lookup.

Degraded mode:
- Connectivity/degraded indicator.
- Manual entry form.
- Reason capture.
- Pending reconciliation list.

Out of scope:
- Full video wall.
- Vendor device control UI before adapter support.

---

## 5. Concierge / Staff Screens

Core:
- Unified inbox.
- Request list and filters.
- Emergency queue.
- Request detail.
- Resident quick view.
- Internal comments.
- Resident-visible updates.
- Package registration and pickup.
- Announcements/documents quick access where permitted.

Out of scope:
- Property-wide configuration.
- Platform tenant management.

---

## 6. Technician Screens

Core:
- Assigned work queue.
- Request detail.
- Status transition controls.
- Resolution notes.
- Result photos/attachments.
- Parts/waiting state.

Out of scope:
- Resident PII beyond work need.
- Contractor company administration.

---

## 7. Contractor Screens

Core:
- Assigned tasks.
- Limited request detail.
- Access window/pass status.
- Completion notes/attachments.

Out of scope:
- Full resident profile.
- Property analytics.
- Staff management.

---

## 8. Property Admin Screens

Core:
- Property dashboard.
- Structure: buildings/entrances/units or sectors/homes/plots.
- Residents and memberships.
- Staff and roles.
- Contractor companies/users.
- Access zones/points.
- Access policies.
- Vehicle registry.
- Requests, SLA and assignment oversight.
- Emergency configuration and queue oversight.
- Announcements and documents.
- Import/onboarding wizard.
- Audit and sensitive-action reviews.
- Access reviews.
- Integration settings.
- Hardware device map.
- Runbook/readiness checklist.

Out of scope:
- Other customers' properties.
- Platform-wide tenant registry unless platform role is present.

---

## 9. Management Company Admin Screens

Core:
- Portfolio overview.
- Cross-property SLA/backlog dashboard.
- Cross-property incident visibility.
- Staff/role governance summary.
- Shared templates and policies.
- Portfolio analytics and exports.
- Sensitive-action summary within company scope.

Out of scope:
- Platform-wide configuration.
- Access to unrelated management companies.

---

## 10. Platform Admin Screens

Core:
- Platform login.
- Management companies registry.
- Properties registry.
- Property create/enable/disable.
- Tenant health.
- Feature/package gating.
- Platform audit.
- Deployment/support status.

Out of scope:
- Daily handling of customer requests.
- Routine resident/service operations.

---

## 11. Acceptance Criteria

- Given a screen is planned, when owner role is chosen, then it maps to exactly one primary role group in this document.
- Given a cottage-community property, when UI renders address/access labels, then apartment-only labels are not shown.
- Given a sensitive field is displayed, when role/scope is insufficient, then the field is masked or hidden.
- Given an emergency request exists, when staff views queues, then emergency state is visually distinct.
- Given a platform admin uses the product, when they manage tenants, then they do not need resident/staff operational screens for daily customer work.

---

## 12. Related Design Docs

- `domhub-design-tokens-css-spec.md`
- `domhub-figma-component-library-structure.md`
- `domhub-react-figma-component-map.md`
- `domhub-unified-design-workflow-pack.md`
