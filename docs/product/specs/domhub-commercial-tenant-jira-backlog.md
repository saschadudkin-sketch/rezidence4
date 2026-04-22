# DomHub — Commercial Tenant Module Jira-Ready Backlog

Статус: bounded execution backlog  
Назначение: превратить optional `commercial_tenant` module в управляемый implementation backlog без расползания в отдельную commercial leasing platform.

## 1. Scope

Goal:
- дать mixed-use объектам ограниченный business-operator contour внутри DomHub.

This backlog is only for:
- company registry;
- company staff;
- company-scoped access;
- company-scoped requests;
- company documents/rules visibility;
- security/property admin visibility.

This backlog is not for:
- commercial lease accounting;
- retail/hospitality CRM;
- bookings or marketplace;
- full finance workflows;
- standalone business-management product.

## 2. Source of truth

- `domhub-commercial-tenant-module-spec.md`
- `domhub-role-maturity-matrix.md`
- `domhub-final-product-plan.md`
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-access-api-contract-spec.md`

## 3. Tickets

### CMT-01 Freeze Commercial Tenant Scope

**Summary**  
Freeze the first bounded scope for the commercial tenant module.

**Scope**
- Confirm pilot assumptions for mixed-use properties
- Confirm role naming and UI label strategy
- Explicitly defer non-module items

**Implementation Notes**
- Keep the module optional and feature-gated
- Align with packaging and rollout rules

**Definition of Done**
- Bounded MVP/v2 scope is documented and approved
- Deferred items list exists
- No finance/lease/product sprawl remains in active scope

**Dependencies**
- None

**Out of Scope**
- Implementation

### CMT-02 Add Commercial Tenant Domain Model

**Summary**  
Add the minimum commercial tenant entities to the domain model.

**Scope**
- `commercial_tenant`
- `commercial_tenant_contact`
- `commercial_tenant_staff`
- status/category fields
- property/building/unit links

**Implementation Notes**
- Keep tenant/property ownership explicit
- Reuse user/profile patterns where possible

**Definition of Done**
- Migrations exist
- Core constraints and indexes exist
- Property scope boundaries are enforced

**Dependencies**
- `CMT-01`

**Out of Scope**
- Lease accounting entities

### CMT-03 Add Permissions And Scope Rules

**Summary**  
Implement scope boundaries for commercial tenant users.

**Scope**
- `commercial_tenant_admin`
- `commercial_tenant_staff`
- property admin visibility rules
- security visibility rules

**Implementation Notes**
- Do not let company users inherit resident or admin powers
- Keep resident PII access restricted by default

**Definition of Done**
- Role and scope checks are implemented
- Tests cover cross-company and cross-unit isolation

**Dependencies**
- `CMT-02`

**Out of Scope**
- Portfolio governance

### CMT-04 Add Commercial Staff Registry Backend

**Summary**  
Implement backend for company employee management.

**Scope**
- add/edit/deactivate staff
- staff validity period
- company affiliation
- active/inactive list filters

**Implementation Notes**
- Property admin must retain audit visibility

**Definition of Done**
- CRUD works under correct company/property scope
- Deactivation affects downstream access eligibility

**Dependencies**
- `CMT-02`
- `CMT-03`

**Out of Scope**
- HR workflows

### CMT-05 Add Company-Scoped Access Flows

**Summary**  
Connect commercial tenant staff and visitors to the access core.

**Scope**
- employee access baseline
- business visitor pass baseline
- company affiliation in access checks
- access windows aligned with company or policy

**Implementation Notes**
- Reuse access request/pass patterns
- Stay policy-based, not hardcoded

**Definition of Done**
- Commercial tenant staff can receive scoped access
- Business visitors can be linked to company scope
- Security sees company affiliation during validation

**Dependencies**
- `CMT-03`
- `CMT-04`

**Out of Scope**
- Full visitor management suite

### CMT-06 Add Commercial Request Scope

**Summary**  
Allow company users to create and track requests related to their premises.

**Scope**
- request creation by commercial tenant admin
- company-unit scoped request list
- limited status visibility
- request history within company scope

**Implementation Notes**
- Reuse request engine, do not fork it
- Keep scope strictly bound to company premises

**Definition of Done**
- Company users can create requests for their premises
- They can only see their own scoped requests
- Property admin and staff can process those requests normally

**Dependencies**
- `CMT-03`

**Out of Scope**
- Commercial SLA product tiering

### CMT-07 Add Company Documents And Rules Visibility

**Summary**  
Expose property rules and mixed-use documents to commercial tenant users.

**Scope**
- document list
- rule visibility
- mixed-use notices
- loading/service instructions

**Implementation Notes**
- Reuse announcements/documents layer

**Definition of Done**
- Company users can read documents meant for their scope
- Property admin can target or expose relevant documents

**Dependencies**
- `CMT-02`

**Out of Scope**
- Full document workflow engine

### CMT-08 Implement Commercial Tenant UI

**Summary**  
Build the minimal commercial tenant admin workspace.

**Scope**
- overview
- staff list
- access list/status
- requests
- documents

**Implementation Notes**
- Keep the surface compact and restricted
- Do not mirror resident home or admin dashboard patterns blindly

**Definition of Done**
- Commercial tenant admin can complete the bounded core flows
- UI respects company scope and feature-gating

**Dependencies**
- `CMT-04`
- `CMT-05`
- `CMT-06`
- `CMT-07`

**Out of Scope**
- Rich analytics

### CMT-09 Add Security-Side Commercial Visibility

**Summary**  
Extend security workspace to recognize company affiliation and business visitor context.

**Scope**
- company badge/label in security validation
- employee vs visitor distinction
- company restrictions visibility

**Implementation Notes**
- Keep security actions unchanged; only extend context

**Definition of Done**
- Security can validate company-linked staff and visitors without ambiguity
- Company context appears in the relevant scan/search/detail states

**Dependencies**
- `CMT-05`

**Out of Scope**
- Separate security workflow for business-only checkpoints

### CMT-10 Add Property Admin Commercial Controls

**Summary**  
Expose commercial tenants inside the property admin control room.

**Scope**
- company registry
- company status
- company staff counts
- suspend/archive controls
- linked incidents/requests visibility

**Implementation Notes**
- This is a property-admin extension, not a new back-office product

**Definition of Done**
- Property admin can inspect and manage company presence on the object
- Core company lifecycle controls exist

**Dependencies**
- `CMT-02`
- `CMT-04`
- `CMT-06`

**Out of Scope**
- Multi-property commercial analytics

### CMT-11 Add Optional Parking Linkage

**Summary**  
Provide optional linkage between commercial tenants and the parking module.

**Scope**
- company vehicle registry hook
- assigned business spots hook
- visitor vehicle access hook

**Implementation Notes**
- Only enable when parking module is present
- Keep it feature-gated

**Definition of Done**
- Commercial tenant records can link to parking baseline entities
- No mandatory dependency exists for properties without parking scope

**Dependencies**
- `CMT-02`
- parking baseline specs/backlog implementation

**Out of Scope**
- Smart parking automation

### CMT-12 Commercial Tenant Pilot Readiness

**Summary**  
Hardening pass for mixed-use pilot readiness.

**Scope**
- tests
- demo data
- property admin rehearsal
- security rehearsal
- company onboarding checklist

**Implementation Notes**
- Treat this as release gate for the optional module

**Definition of Done**
- Main company flows are rehearsed end-to-end
- Mixed-use pilot can be demonstrated without manual hacks
- Feature flag and rollout guidance are documented

**Dependencies**
- `CMT-08`
- `CMT-09`
- `CMT-10`

**Out of Scope**
- Broad vendor rollout

## 4. Recommended execution order

1. `CMT-01`
2. `CMT-02`
3. `CMT-03`
4. `CMT-04`
5. `CMT-05`
6. `CMT-06`
7. `CMT-07`
8. `CMT-08`
9. `CMT-09`
10. `CMT-10`
11. `CMT-11`
12. `CMT-12`

## 5. Release gate

Commercial tenant module should not be enabled for a property until:
- role scope tests pass;
- company staff and access flows work;
- property admin can govern companies;
- security sees company affiliation correctly;
- mixed-use pilot rehearsal is complete.
