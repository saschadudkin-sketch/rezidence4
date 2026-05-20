# Pilot Rollout Runbook

Status: Draft, release-gate controlled.
Scope: first live property or tightly bounded staging/prod-candidate pilot.

This runbook is the operational wrapper around the product release gates. It
does not replace detailed tenant, restore or go-live runbooks; it gives the
pilot owner a single go/no-go checklist and escalation path.

## Roles

| Role | Owner |
|---|---|
| Pilot owner | Ops And Enablement |
| Engineering owner | Platform Backend / Frontend App |
| Data owner | Data And Infra |
| Support owner | Support / Property Admin lead |
| Security/checkpoint owner | Security Lead |

## Property Launch

Before launch:
- target property, package and property type are confirmed;
- `npm run release:gate:check` passes;
- `npm run verify:strict` has a clean CI/staging result or an explicit waiver;
- staging/prod-candidate smoke evidence includes `e2e/v1-access-production.spec.js`,
  `e2e/v1-packages-production.spec.js`, and
  `e2e/v1-service-execution-production.spec.js`;
- platform admin can see the property lifecycle state.

## Tenant Provisioning And Migrations

Use the tenant-ops commands, not manual SQL:

```bash
npm run tenant:provision -- --slug <slug> --name "<name>" --db-url <postgresql-url>
npm run tenant:migrate -- --slug <slug>
npm run tenant:preflight:current
```

Go/no-go checks:
- platform registry row exists and points to the intended DB;
- tenant DB has the full property migration chain;
- initial property admin exists or is intentionally deferred;
- no migration failure is left without owner and rollback decision.

## Resident Import And Activation

Before inviting residents:
- import template is reviewed for target property type;
- units/homes, residents, staff, vehicles and planned checkpoints import without manual DB edits;
- activation messages and support contacts are confirmed;
- sample resident can create guest and vehicle access flows.

## Guard/Checkpoint Training

Before checkpoint go-live:
- checkpoint/access point names match the physical site;
- guards know pass scan, plate lookup, vehicle direction and manual admit flows;
- every checkpoint device is enrolled and approved before the `guard_authorized_devices` flag is enforced;
- security lead has the escalation contacts;
- training uses the same environment and role set as the pilot.

## Degraded Checkpoint Mode

Connectivity/provider outage procedure:
- guard records manual decisions with access point, direction, plate/pass and reason;
- offline replay queue is checked after recovery and reconciled in the security workspace;
- support opens an incident when degraded mode lasts longer than the agreed threshold;
- engineering verifies whether the issue is tenant DB, network, SKUD/VMS provider or frontend runtime;
- reconciliation is completed after service recovery.

## Emergency Dispatch

Emergency requests must be visibly distinct from normal service work:
- concierge/security confirms priority and contact route;
- property admin or duty manager owns escalation;
- notification/outbox state is checked if alerts do not arrive;
- incident notes capture response and follow-up.

## First-Week Support

Daily for the first live week:
- review access incidents, manual overrides and denied entries;
- review operations dashboard access metrics: allow/deny by access point, deny reasons, offline replay, trusted visitor usage and SKUD manual-control/failure counts;
- review notification failures and resident activation issues;
- review import/data correction requests;
- review guard/support feedback from the previous day;
- decide whether to continue, pause or roll back the pilot.

## Pilot Operations Training Pack

Before go-live, run:

```bash
npm run pilot:training-pack
```

The DH-61 training pack lives in `docs/runbooks/pilot-operations-training-pack.md`
and must cover first-week support, guard/checkpoint training, emergency drill,
resident offboarding drill, PDn/DSAR support and daily evidence capture.

## Incident Escalation

Escalate immediately when:
- tenant resolution fails for the live property;
- access decisions cannot be recorded;
- resident personal data is exposed to the wrong scope;
- backups or restore drill fail;
- SKUD/video/ERP integration silently desynchronizes.

Minimum escalation record:
- property slug;
- affected role/workflow;
- start time and current status;
- impact estimate;
- owner and next update time.

## Data Correction And Offboarding

Support must not patch production data ad hoc. Use product workflows or a
tracked engineering runbook for:
- wrong unit/home/resident relationship;
- vehicle linked to the wrong resident/home;
- staff role or scope mistake;
- resident move-out, sale, lease end or duplicate identity.

Every correction needs an audit trail or ticket reference.

## Backup/Restore And Rollback

Before go-live or high-risk migration:

```bash
npm run tenant:restore-drill:preflight
npm run tenant:restore-drill
```

Rollback decision requires:
- latest backup files are fresh and restorable;
- affected database scope is known: platform, one tenant or full environment;
- property/support communications are ready;
- engineering owner confirms restore ordering.

## Go/No-Go Decision

Go only when:
- release gate matrix passes;
- strict CI/staging evidence is green or waived;
- tenant provisioning/migration/preflight evidence is green;
- restore drill evidence exists for real backup files;
- support owner and security/checkpoint owner accept first-week process.

No-go when any P0/P1 issue lacks owner, rollback path or communication plan.
