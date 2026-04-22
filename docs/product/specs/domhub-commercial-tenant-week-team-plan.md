# DomHub Commercial Tenant Week And Team Plan

This document maps the optional `commercial_tenant` module to a practical mixed-use pilot delivery plan.

It assumes:

- the residential core remains the main product;
- mixed-use is enabled only for qualified properties;
- the module remains bounded to company registry, staff, access, requests, documents, and limited governance;
- no lease ERP, bookings, or commercial finance product enters the delivery wave.

## Planning Model

- Duration: 3 weeks
- Mode: bounded mixed-use pilot wave
- Strategy:
  - Week 1 = freeze scope and establish domain boundaries
  - Week 2 = connect the module to access and requests and ship the main company UI
  - Week 3 = finish governance, optional parking linkage, and pilot readiness

## Team Model

- `Product And Design`
  - mixed-use scope freeze
  - role labeling and UI boundary decisions
  - compact company workspace decisions

- `Platform Backend`
  - company domain entities
  - permissions and scope
  - staff registry
  - access and request linkage

- `Frontend App`
  - commercial tenant workspace
  - security-side mixed-use visibility
  - property admin mixed-use controls

- `Data And Infra`
  - migrations
  - schema integrity
  - staging stability for mixed-use rollout

- `Integrations`
  - access linkage support
  - optional parking linkage
  - future-safe hooks for mixed-use onboarding

- `QA And Release`
  - scope and boundary verification
  - permission tests
  - end-to-end mixed-use pilot rehearsal

- `Ops And Enablement`
  - pilot property assumptions
  - demo data
  - rollout notes
  - support checklist for mixed-use properties

## Critical Path

The commercial tenant critical path is:

1. `CMT-01`
2. `CMT-02`
3. `CMT-03`
4. `CMT-04`
5. `CMT-05`
6. `CMT-06`
7. `CMT-08`
8. `CMT-09`
9. `CMT-10`
10. `CMT-12`

`CMT-07` can overlap with access/request work.  
`CMT-11` is optional and can run in parallel in Week 3 when parking baseline exists.

## Week 1

**Goal**  
Freeze the mixed-use module and establish the domain and scope boundaries.

**Primary Teams**
- Product And Design
- Platform Backend
- Data And Infra

**Tickets**
- `CMT-01`
- `CMT-02`
- `CMT-03`
- `CMT-04`

**Expected Output**
- mixed-use scope is frozen;
- commercial tenant entities exist;
- permissions and company boundaries are enforced;
- company staff registry backend exists.

**Support**
- QA And Release:
  - permission smoke checks
  - cross-company isolation checks

**Risk Notes**
- If `CMT-01` slips, the module will sprawl into lease/accounting or marketplace ideas.
- If `CMT-03` slips, the whole module becomes risky from a privacy and governance perspective.

## Week 2

**Goal**  
Connect mixed-use companies to access and requests and ship the main company workspace.

**Primary Teams**
- Platform Backend
- Frontend App

**Tickets**
- `CMT-05`
- `CMT-06`
- `CMT-07`
- `CMT-08`
- `CMT-09`

**Expected Output**
- company staff and visitors can use scoped access flows;
- companies can create and track requests for their premises;
- documents and rules are visible to company users;
- the minimal commercial tenant UI is usable;
- security sees company affiliation during validation.

**Support**
- Product And Design:
  - UI boundary review
- QA And Release:
  - access/request smoke tests

**Risk Notes**
- `CMT-08` must stay compact. If it grows into a full business-management console, delivery will slip.
- `CMT-09` must extend security context only, not fork the security workflow.

## Week 3

**Goal**  
Finish property-admin governance, optional parking linkage, and mixed-use pilot readiness.

**Primary Teams**
- Frontend App
- QA And Release
- Ops And Enablement
- Integrations

**Tickets**
- `CMT-10`
- `CMT-11`
- `CMT-12`

**Expected Output**
- property admin can inspect and manage company presence on the object;
- optional parking linkage exists if the parking baseline is enabled;
- mixed-use pilot can be demonstrated and rehearsed end to end.

**Support**
- Platform Backend:
  - bug fixes
  - route stabilization
- Data And Infra:
  - migration and staging reliability

**Risk Notes**
- `CMT-12` is the release gate for mixed-use pilot wave.
- If property admin cannot control company presence cleanly, the module will feel operationally incomplete even if company UI works.

## Parallelization Rules

- `CMT-02` and `CMT-03` can overlap once scope is frozen.
- `CMT-05` and `CMT-06` can progress in parallel after scope boundaries are stable.
- `CMT-07` can run in parallel with backend mixed-use flows.
- `CMT-08` and `CMT-09` can overlap once access-related APIs are stable.
- `CMT-11` should run only if parking baseline is already available or committed for the property.

## Cross-Team Dependencies

### Product And Design -> Frontend App

- The company workspace must remain compact and bounded before frontend implementation expands.

### Platform Backend -> Frontend App

- Frontend depends on stable mixed-use routes, company staff model, and scoped access/request data.

### Data And Infra -> Platform Backend

- Clean migrations and reliable staging are required before a mixed-use pilot can be tested safely.

### Integrations -> Product/Ops

- Parking linkage and future onboarding hooks should remain optional, not mandatory for rollout.

### QA And Release -> Everyone

- Privacy, scope, and cross-company visibility checks are more important than UI polish for this module.

## Minimum Weekly Review Questions

### End Of Week 1

- Is mixed-use scope frozen?
- Are company entities and permissions bounded correctly?
- Is cross-company isolation covered?

### End Of Week 2

- Can a company admin manage staff, requests, and access status?
- Does security see company context clearly?
- Has the UI remained bounded?

### End Of Week 3

- Can property admin govern company presence on the object?
- Is the module ready for a real mixed-use pilot?
- Is parking linkage still optional and safe?

## Compression Note

This plan can be compressed below 3 weeks only if:

- the property has a very small mixed-use footprint;
- the company UI ships as a lean list-and-detail workspace;
- parking linkage is deferred;
- the team accepts reduced polish and a lighter pilot rehearsal.

Otherwise, use the 3-week plan above as the default mixed-use delivery mode.
