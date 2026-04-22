# DomHub — Commercial Tenant / Business Partner Module Specification

Статус: working optional module specification  
Назначение: определить optional module для смешанных объектов, где на территории работают коммерческие арендаторы или сервисные компании: салоны, клиники, кофейни, магазины, студии, офисы и другие business operators.

## 1. Purpose

DomHub в базовой форме строится как residential operations platform.

Но на части объектов есть:
- салоны красоты;
- медклиники;
- кафе и кофейни;
- магазины;
- детские студии;
- офисы сервисных компаний;
- иные business operators внутри property perimeter.

Для таких объектов нужен отдельный модуль.

Он не должен:
- превращать DomHub в полноценную commercial leasing platform;
- дублировать ERP/tenant accounting;
- ломать resident-first и property-operations-first архитектуру.

Он должен:
- дать business operators ограниченный рабочий контур;
- встроить их в access, requests, parking, documents, and incident flows;
- позволить property staff управлять ими как частью объекта.

## 2. Recommended naming

Preferred product role:
- `commercial_tenant`

Alternative commercial-facing label:
- `business_partner`

Recommended rule:
- во внутренней доменной модели использовать `commercial_tenant`;
- в UI можно выбирать более мягкую формулировку `Business Partner` или `Company On Site`, если это лучше для бренда объекта.

## 3. When the module is needed

Module is recommended when:
- объект mixed-use;
- на объекте есть коммерческие помещения;
- компании имеют сотрудников, которым нужен регулярный доступ;
- есть служебный транспорт, курьеры, подрядчики или посетители бизнеса;
- property team хочет централизованно управлять правилами для таких компаний.

Module is not required when:
- объект purely residential;
- коммерческих помещений нет;
- достаточно только обычных contractor flows.

## 4. Product position

This is an optional module.

It should sit between:
- residential core;
- contractor workflows;
- property access governance.

It is not:
- a resident role;
- a finance ERP replacement;
- a full retail/hospitality operating system.

## 5. Primary actors

### 5.1 `commercial_tenant_admin`

Представитель компании на объекте.

Can:
- manage company staff list;
- request or manage staff access;
- request guest/business visitor access;
- submit service requests for the commercial unit;
- read building documents and rules;
- track incidents or restrictions relevant to the company.

### 5.2 `commercial_tenant_staff`

Сотрудник компании на объекте.

Can:
- access only permitted zones and schedules;
- see own access status;
- receive business-related notifications;
- operate under the company scope only.

### 5.3 `property_admin`

Remains the controlling role.

Can:
- approve or restrict commercial tenant access rules;
- inspect staff lists;
- audit passes and incidents;
- manage parking/business assignments where enabled.

### 5.4 `security`

Can:
- validate staff and visitor access for business operators;
- see company affiliation;
- apply allow/deny/manual override;
- create incidents around commercial access events.

## 6. Core capabilities

## 6.1 Company profile

Each commercial operator should have:
- legal or display name;
- unit / premises reference;
- contact person;
- contact phone/email;
- category:
  - salon
  - clinic
  - cafe
  - retail
  - office
  - studio
  - other
- operating hours;
- status:
  - active
  - suspended
  - archived

## 6.2 Staff registry

Commercial tenant admin should be able to:
- add staff members;
- deactivate staff members;
- assign role or level;
- define employment/access validity period;
- upload or maintain basic identifiers.

Property admin should be able to:
- audit staff list;
- suspend company or individual access;
- review active vs inactive records.

## 6.3 Access management

Commercial module must connect to the access core.

Needed:
- staff access for company employees;
- business visitor passes;
- courier/service access if company requests it;
- access windows by operating hours or policy;
- zone/point restrictions;
- blacklist and incident linkage.

## 6.4 Requests and service operations

Commercial tenants should be able to create service requests related to their unit:
- maintenance;
- facility issue;
- access issue;
- loading/service access issue;
- document/helpdesk issue.

This should reuse the same request engine, but stay scoped to the company unit.

## 6.5 Parking and vehicle support

If parking module is enabled, commercial tenants may need:
- company vehicle registry;
- assigned business parking spots;
- visitor vehicle passes;
- service vehicle access windows.

This must remain optional and property-controlled.

## 6.6 Documents and rules

Commercial operators need access to:
- building rules;
- loading/unloading rules;
- access policies;
- fire/safety instructions;
- contractor/service requirements;
- mixed-use operational notices.

## 6.7 Notifications

Commercial tenants should receive:
- access-related notifications;
- incident notifications where relevant;
- request status updates;
- operational building notices.

Channels:
- push if app-enabled;
- SMS where needed;
- email optionally later;
- Telegram optionally by property configuration.

## 7. Domain model baseline

Recommended entities:
- `commercial_tenant`
- `commercial_tenant_contact`
- `commercial_tenant_staff`
- `commercial_tenant_vehicle`
- `commercial_tenant_access_policy_link`
- `commercial_tenant_request_scope`

Minimum references:
- property
- building
- unit / premises
- linked user accounts if present
- company status

## 8. Permissions and boundaries

Commercial tenant users must never behave like unrestricted residents or admins.

Rules:
- no visibility outside their own company scope;
- no cross-unit data access;
- no resident PII access by default;
- no broad request board visibility;
- no property-wide incident visibility;
- no policy editing rights.

Property admin remains the authority.

## 9. MVP scope

Commercial tenant module should only enter MVP if a pilot property explicitly needs it.

If enabled in MVP, keep it bounded:
- company profile
- company staff list
- limited employee access management
- company-side service requests
- document/rules visibility
- security-side visibility of company affiliation

Do not include in MVP:
- lease accounting;
- commercial invoicing;
- retail analytics;
- consumer booking systems;
- marketplace features;
- tenant billing engine.

## 10. Strong v2 scope

In `v2`, the module can expand to:
- richer staff lifecycle;
- richer visitor flows;
- parking linkage;
- business-specific access rules;
- commercial incident visibility;
- limited analytics by company.

## 11. Mature v3 scope

In `v3`, only if justified by the market:
- stronger mixed-use governance;
- richer company onboarding;
- portfolio reporting for commercial operators across properties;
- business performance-facing integrations where strategically useful.

Still avoid turning the module into a full vertical SaaS for salons or clinics.

## 12. UI surfaces

## 12.1 Commercial tenant admin workspace

Recommended sections:
- `Overview`
- `Staff`
- `Access`
- `Requests`
- `Vehicles` if enabled
- `Documents`
- `Notifications`

Main goals:
- fast employee administration;
- clear access status;
- service requests without friction;
- property rule visibility.

## 12.2 Security workspace additions

Security should see:
- company name;
- employee vs guest/business visitor type;
- company access window;
- restrictions or flags;
- linked vehicle or delivery context where relevant.

## 12.3 Property admin workspace additions

Property admin should get:
- company registry;
- active/inactive companies;
- company staff counts;
- company access issues/incidents;
- ability to suspend company access or deactivate records.

## 13. Integrations

Optional future integrations:
- ERP/1C commercial directory sync if client already tracks tenants there;
- access vendor sync for employee credentials;
- parking sync for assigned commercial spots.

But:
- no hard dependency on ERP;
- no coupling to commercial accounting in early stages.

## 14. Risks

Main risks:
- module scope explodes into full commercial property management;
- company users get too much visibility;
- mixed-use needs distort residential UX;
- access and requests become overly complicated for properties that do not need this module.

## 15. Product decision rule

Enable this module only when all of the following are true:

1. The property actually has business operators on site
2. Those operators need repeatable access and service workflows
3. Property admin wants them governed inside the same operating system
4. The module can stay bounded to access/requests/documents/vehicles

If these conditions are not met:
- use resident + contractor + admin flows instead.

## 16. Recommended product stance

DomHub should support `commercial_tenant` as:
- an optional mixed-use operations module;
- strongly scoped;
- access- and service-linked;
- property-admin-controlled.

DomHub should not market this first as:
- software for salons;
- software for clinics;
- commercial lease ERP;
- retail operations software.

The correct positioning is:

> DomHub can also govern commercial operators inside premium mixed-use residential properties, without breaking the residential operations core.
