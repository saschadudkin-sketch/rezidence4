# Pilot Operations Training Pack

Status: Draft, release-gate controlled.
Scope: `DH-61` first property pilot operations package.

This pack turns the pilot rollout runbook into a training and acceptance
package for the people who will operate the first live week. It is not a
replacement for `docs/runbooks/pilot-rollout.md`; it is the evidence wrapper
used to prove that support, guards, emergency owners and PDn/DSAR handlers know
the workflow before go-live.

## Pack Overview

The training pack must be completed before a Russia production pilot can pass
the readiness gate.

Required modules:
- first-week support routine;
- guard/checkpoint training;
- emergency drill;
- resident offboarding drill;
- PDn/DSAR support handling;
- daily evidence capture and sign-off.

Expected retained evidence:
- attendance or acknowledgement list for each role group;
- drill notes and timestamps;
- screenshots or exported records from the relevant DomHub admin pages;
- unresolved questions, waiver owner and follow-up ticket if any item is not complete.

## Roles And Sign-Off

| Role | Must sign off | Evidence |
|---|---|---|
| Pilot owner | Overall go/no-go, waiver ownership | Go/no-go note |
| Support owner | First-week queue, resident support, correction flow | Support handoff note |
| Security/checkpoint owner | Guard console and degraded-mode procedure | Guard training checklist |
| Property admin lead | Offboarding, ownership transfer, admin escalation | Admin drill note |
| Emergency owner | Emergency request queue, escalation and notification evidence | Emergency drill record |
| PDn owner | DSAR intake, export/delete/correct/restrict handling | PDn/DSAR checklist |
| Engineering owner | Release gates, tenant preflight, restore drill evidence | Gate output links |

Sign-off is acceptable only when the owner records either `accepted` or
`accepted_with_waiver` plus the waiver owner and follow-up date.

## First-Week Support

Cadence:
- morning review before resident traffic starts;
- midday check for notification failures and activation issues;
- end-of-day incident, DSAR and correction review.

Daily checks:
- access incidents and denied entries are reviewed;
- manual overrides have reason and actor;
- notification failures are triaged from outbox/log views;
- resident activation problems have support owner and status;
- offboarding or correction requests are not handled by ad hoc SQL;
- go/no-go state is updated for continue, pause or rollback.

Escalate immediately when:
- tenant context resolution fails;
- resident personal data appears outside the expected scope;
- checkpoint cannot record access decisions;
- emergency notification evidence is missing;
- restore/rollback evidence is stale.

## Guard/Checkpoint Training

The guard/checkpoint session must use the same environment, tenant and role set
as the pilot.

Training flow:
1. Open the security workspace and confirm checkpoint/access point labels.
2. Verify a resident pass or guest pass.
3. Perform a plate lookup for a whitelisted vehicle.
4. Record a manual admit and a manual deny with reason.
5. Simulate degraded connectivity procedure and document later reconciliation.
6. Escalate a suspicious access event into an incident.
7. Open the operations dashboard and verify the training actions appear in allow/deny by access point, deny reasons, offline replay and manual-control metrics.

Expected evidence:
- trainer, participants and environment;
- pass/plate/manual-control examples;
- degraded-mode threshold and escalation contact;
- screenshot or exported snapshot of the access operations dashboard for the training period;
- list of terms that guards must use consistently at the physical site.

## Emergency Drill

The emergency drill must prove that emergency work is visibly distinct from
ordinary service requests.

Drill flow:
1. Create or identify a P0/P1 emergency scenario.
2. Confirm queue visibility and priority/SLA fields.
3. Confirm on-call owner and escalation route.
4. Record notification/provider delivery evidence.
5. Confirm acknowledgement or timeout handling.
6. Capture incident notes and follow-up owner.

Acceptance:
- emergency queue shows the event;
- notification evidence exists or a waiver is recorded;
- escalation owner is named;
- drill status is `passed` or `accepted_with_waiver`.

## Resident Offboarding Drill

The resident offboarding drill covers move-out, sale, lease end and duplicate
identity correction.

Drill flow:
1. Pick a test resident with active access, vehicle or request links.
2. Run resident offboarding or ownership transfer through the product workflow.
3. Confirm memberships, unit links, active passes and pending access requests are revoked or marked.
4. Confirm vehicles enter review when automatic removal is unsafe.
5. Confirm notification preferences are disabled or cascaded according to policy.
6. Review the offboarding report evidence.

No acceptance is allowed if the drill requires manual SQL without a tracked
engineering runbook.

## PDn/DSAR Support

PDn/DSAR support covers export/delete/correct/restrict requests.

Support flow:
1. Receive a resident request and identify request type.
2. Create `/api/v1/privacy/data-subject-requests` evidence or use the product UI when available.
3. For export, capture the subject export snapshot.
4. For delete, confirm anonymization/deletion procedure and retention decision.
5. For correct/restrict, record the resolution note and retained evidence.
6. Confirm `/api/v1/privacy/readiness` includes latest evidence for DSAR workflow, retention, localization, ИСПДн and no-biometrics guard.

Escalate to the PDn owner when the request scope is unclear, when legal basis is
disputed, or when a requested deletion conflicts with required operational
retention.

## Daily Evidence Capture

Store the daily pilot evidence package under the release evidence location used
by the pilot owner. For strict readiness, retain a JSON summary compatible with:

```text
artifacts/russia-readiness/dh61-training-pack.json
```

The JSON must follow `docs/runbooks/russia-readiness-evidence-capture.md`.

Minimum JSON fields:
- `property_slug`;
- `training_date`;
- `accepted_by`;
- `first_week_support`;
- `guard_checkpoint_training`;
- `emergency_drill`;
- `resident_offboarding_drill`;
- `pdn_dsar_support`;
- `open_waivers`.

The file should link to screenshots, exported reports or ticket IDs instead of
embedding sensitive personal data.

## Go/No-Go And Rollback

Go only when:
- `npm run pilot:training-pack` passes;
- `npm run pilot:readiness` passes;
- `npm run russia:readiness` passes;
- restore drill evidence is current;
- support, checkpoint, emergency and PDn owners accept their workflows.

No-go when:
- any P0/P1 issue lacks owner or rollback path;
- checkpoint training did not run in the intended tenant;
- emergency drill evidence is absent;
- DSAR/offboarding support has no named owner;
- a biometric identity matching request is treated as in-scope for MVP/v2 Core.

## Training Acceptance

The pack is complete when:
- all role groups have a sign-off line;
- each required drill has evidence;
- open waivers have owner and follow-up date;
- the pilot owner accepts the first-week support process;
- DH-61 is represented in `npm run russia:readiness`.
