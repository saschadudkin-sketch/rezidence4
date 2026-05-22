# Pilot Readiness Rehearsal — 2026-05-22

Status: local browser/runtime gates green; live/staging Russia readiness evidence still blocks sign-off.

Scope: package edge UX/E2E, service execution role-navigation rehearsal, release gate runtime evidence, restore preflight, and strict live Russia readiness evidence check.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `npm run test:e2e:v1-packages` | Passed | 5 browser-backed package scenarios: resident deny, security intake/pickup, duplicate reminder 429 UI copy, concierge return, admin mark-lost. |
| `npm run test:e2e:v1-service-execution` | Passed | 2 browser-backed service execution scenarios: staff/technician/contractor via `OperationsNav`, plus wrong-role 403 and stale 409 UI copy. |
| `npm run release:gate:check` | Passed | Runtime evidence under `artifacts/release-gates/` is fresh enough for the local gate. |
| `npm run tenant:restore-drill:preflight` | Passed | Docker available; `residenze`, `platform`, and `zamoskv` backups are under the 48h freshness limit. |
| `npm run russia:readiness -- --require-live --live-dir artifacts/russia-readiness` | Failed | DH-55 through DH-61 retained live/staging evidence files are missing. |

## Green Baseline

- Browser-backed v1 packages E2E proves role navigation, staff intake, resident visibility, pickup, reminder rate-limit copy, stale transition copy, return, and admin mark-lost.
- Browser-backed v1 service execution E2E now avoids manual workspace URLs: staff, technician, and contractor screens are reached through `/v1` and `OperationsNav`.
- Service execution E2E proves a contractor cannot call technician work endpoints directly and a stale technician action shows user-facing conflict copy instead of raw backend text.
- Local release gate matrix passes with runtime evidence required.
- Restore preflight passes locally with fresh backup files.

## Blocking Gaps Before Pilot Sign-Off

The strict Russia readiness gate still requires retained live/staging JSON evidence under `artifacts/russia-readiness/`. The current missing files are:

- `dh55-ownership-transfer.json`
- `dh56-privacy-compliance.json`
- `dh57-provider-delivery.json`
- `dh58-gis-oss-package.json`
- `dh59-field-rollout.json`
- `dh60-sensitive-report.json`
- `dh61-training-pack.json`

`staging-verify-strict.json` and `staging-restore-drill.json` are no longer the current failing items in the local check, but they must still represent real staging/prod-candidate artifacts before sign-off.

## Go/No-Go

No-go for real pilot sign-off until DH-55 through DH-61 live/staging evidence is captured with `docs/runbooks/russia-readiness-evidence-capture.md` and `npm run russia:readiness -- --require-live --live-dir artifacts/russia-readiness` passes.

Local engineering readiness remains green; operational release readiness is blocked on retained live/staging evidence, not on the v1 browser flows covered in this rehearsal.
