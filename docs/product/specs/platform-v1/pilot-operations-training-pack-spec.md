# platform-v1 — Pilot Operations Training Pack

Status: Draft
Backlog: `DH-61 Pilot Operations And Training Pack`

## 1. Scope

`DH-61` packages the first pilot's human operating model. It proves that
support, guard/checkpoint, emergency, offboarding and PDn/DSAR workflows can be
run by named owners before the first live week starts.

This module is documentation and release-evidence infrastructure. It does not
add a new product surface unless a later workflow UI is approved.

## 2. Required Pack Contents

The pack must cover:

- first-week support cadence;
- guard/checkpoint training;
- emergency drill;
- resident offboarding or ownership-transfer drill;
- PDn/DSAR support handling;
- daily evidence capture;
- go/no-go and rollback handoff.

## 3. Evidence Contract

Baseline evidence is checked by:

```bash
npm run pilot:training-pack
```

Strict Russia readiness can additionally require retained live evidence:

```text
artifacts/russia-readiness/dh61-training-pack.json
```

Minimum retained evidence fields:

- `property_slug`;
- `training_date`;
- `accepted_by`;
- `first_week_support`;
- `guard_checkpoint_training`;
- `emergency_drill`;
- `resident_offboarding_drill`;
- `pdn_dsar_support`;
- `open_waivers`.

The retained JSON must link to sensitive evidence instead of embedding resident
personal data.

## 4. Acceptance

- Given a pilot is prepared, when `npm run pilot:training-pack` runs, then the
  DH-61 runbook, spec and required sections are present.
- Given guard/checkpoint training is complete, when evidence is reviewed, then
  scan, plate lookup, manual decision, degraded mode and escalation paths are represented.
- Given an emergency drill is complete, when evidence is reviewed, then queue,
  SLA/priority, escalation owner and notification/provider evidence are represented.
- Given offboarding support is trained, when evidence is reviewed, then passes,
  vehicles, memberships, notification preferences and report evidence are covered.
- Given PDn/DSAR support is trained, when evidence is reviewed, then export,
  delete, correct and restrict handling are represented without embedding PII in release artifacts.
