# DomHub — Role Maturity Matrix

Статус: working product planning document  
Назначение: зафиксировать, какие роли и рабочие контуры обязательны для `MVP`, какие нужны для `v2`, а какие должны быть отложены до `v3` или реализованы как integration/support layer.

## 1. Why this document exists

В DomHub нельзя относиться ко всем ролям одинаково.

Некоторым ролям нужен полноценный ежедневный workspace:
- `resident`
- `security`
- `concierge`
- `technician`
- `property_admin`

Некоторым ролям нужен ограниченный execution contour:
- `contractor`
- `commercial_tenant`

Некоторым функциям не нужен отдельный “кабинет” в первой волне.
Им нужен export/integration/compliance layer:
- legal
- finance/accounting

Этот документ нужен, чтобы:
- не расползать MVP;
- не строить лишние кабинеты слишком рано;
- понимать, где нужен full UI, а где достаточно data visibility, exports, and integrations.

## 2. Role categories

### 2.1 Core daily workspaces

Это роли, без которых платформа не работает как residential operations product:
- `resident`
- `security`
- `concierge`
- `technician`
- `property_admin`

### 2.2 Controlled external workspaces

Это роли, которые нужны не на каждом объекте и часто должны быть ограничены по scope:
- `contractor`
- `commercial_tenant`

### 2.3 Portfolio and platform governance

Это роли верхнего уровня управления:
- `management_company_admin`
- `platform_admin`

### 2.4 Support and compliance layers

Это не обязательно отдельные самостоятельные product surfaces в MVP:
- legal
- finance/accounting
- integrations operators

## 3. Maturity matrix

| Role / Function | MVP | Strong v2 | Mature v3 | Surface type |
|---|---|---|---|---|
| `resident` | Required | Required | Required | Full self-service workspace |
| `security` | Required | Required | Required | Full real-time workspace |
| `concierge` | Baseline | Required | Required | Operational queue/workspace |
| `technician` | Baseline or early v2 | Required | Required | Execution workspace |
| `property_admin` | Required | Required | Required | Full control dashboard |
| `contractor` | Minimal | Required | Required | Restricted external portal |
| `management_company_admin` | Optional baseline | Required | Required | Portfolio dashboard |
| `platform_admin` | Not required | Baseline | Required | Internal governance workspace |
| Legal / compliance | Export + audit only | Stronger exports + controls | Mature compliance pack | Support layer, not daily workspace |
| Finance / accounting | Billing visibility + ERP hooks | Stronger finance sync | Mature finance-linked workflows | Integration/support layer |
| `commercial_tenant` / `business_partner` | Optional, only for mixed-use pilots | Recommended for mixed-use | Mature optional module | Restricted external portal |

## 4. Recommended role-by-role treatment

## 4.1 `resident`

`resident` is always core.

MVP must include:
- guest pass flow;
- vehicle pass flow;
- request creation;
- request status visibility;
- announcements/documents;
- notifications.

## 4.2 `security`

`security` is always core.

MVP must include:
- QR validation;
- search by guest, apartment, vehicle, pass;
- allow/deny/manual override;
- visit logs;
- incident baseline.

## 4.3 `concierge`

`concierge` should be in MVP or the first wave immediately after MVP.

Minimum expectation:
- requests queue;
- resident lookup;
- pass assistance;
- package/help desk style operations.

## 4.4 `technician`

`technician` is strategically important and should not be treated as optional long-term.

If engineering capacity is limited:
- technician workflow can be a thin execution layer in MVP;
- but by `v2` it must become a full execution workspace.

Required by `v2`:
- assigned tasks;
- status transitions;
- notes/photos/results;
- SLA awareness;
- access linkage to service work.

## 4.5 `contractor`

`contractor` should not inherit resident UX.

MVP expectation:
- minimal restricted access for assigned work only.

By `v2`:
- contractor portal;
- assigned jobs;
- linked access windows;
- result submission;
- visibility boundaries and audit.

## 4.6 `property_admin`

`property_admin` is always core.

MVP must include:
- dashboard;
- request oversight;
- access and incidents visibility;
- staff/contractor controls;
- announcements/documents baseline.

## 4.7 `management_company_admin`

This role is not always required for the first pilot.

If the first launch is a single property:
- this role may stay thin in MVP.

If the commercial target is a real portfolio:
- this role should appear early.

By `v2` it should include:
- portfolio overview;
- KPI comparison;
- object health;
- cross-property operational visibility.

## 4.8 `platform_admin`

This is internal.

Do not build a large productized workspace in MVP.

Need only:
- tenant registry controls;
- feature flags;
- rollout/config support;
- internal operational tooling.

## 4.9 Legal / compliance

Legal is required, but not as a front-line daily UI role.

MVP needs:
- document templates;
- audit trail;
- policy and consent visibility;
- incident/export capability.

`v2` and `v3` can add:
- richer compliance reporting;
- retention/deletion workflow support;
- legal-case exports;
- stronger access policy evidence packs.

## 4.10 Finance / accounting

Finance is required operationally, but should not dominate the core product.

MVP needs:
- billing record visibility where relevant;
- import/export hooks;
- ERP / 1C integration baseline.

Do not turn DomHub into accounting software.

## 4.11 `commercial_tenant` / `business_partner`

This role is optional and only needed when the property is mixed-use:
- salons;
- clinics;
- coffee shops;
- studios;
- offices;
- other service businesses on site.

MVP:
- only if pilot explicitly requires it.

Recommended treatment:
- keep as optional module;
- restricted visibility;
- separate from resident role;
- linked to access, requests, documents, and staff lists.

## 5. What must be in first working MVP

Required:
- `resident`
- `security`
- `property_admin`
- baseline `concierge`
- baseline `technician`
- restricted `contractor`

Support-only, not full workspaces:
- legal/compliance layer
- finance/billing visibility layer

Optional:
- `management_company_admin`
- `commercial_tenant`

Not required:
- mature `platform_admin`

## 6. What must be in strong v2

Required by `v2`:
- full `technician` workflow
- full `contractor` workflow
- mature `concierge` workspace
- `management_company_admin` portfolio layer
- stronger legal/compliance exports
- stronger ERP/1C and finance-linked visibility

Conditional for mixed-use properties:
- `commercial_tenant` module baseline

## 7. What should remain deferred

The following should not expand MVP unnecessarily:
- standalone legal workspace;
- standalone accounting workspace;
- heavy commercial lease management;
- advanced mixed-use business billing;
- enterprise internal back-office surfaces that are better handled through integrations.

## 8. Product decision rule

When evaluating a new role, ask:

1. Is this role a daily operational actor in the property?
2. Does this role need direct action-taking inside DomHub?
3. Can the need be solved with exports/integrations instead of a full workspace?
4. Is the role required for every property or only mixed-use/premium cases?

If the answer is mostly:
- daily;
- action-taking;
- property-critical;

then it deserves a product workspace.

If the answer is mostly:
- periodic;
- compliance/reporting;
- external system dependent;

then it should stay an integration or support layer first.

## 9. Recommended product stance

For DomHub, the correct priority is:

1. Core resident/staff/security/admin operations
2. Technician and contractor execution maturity
3. Portfolio and integration maturity
4. Optional mixed-use roles like `commercial_tenant`
5. Deeper legal/finance enablement as support layers, not core-first interfaces
