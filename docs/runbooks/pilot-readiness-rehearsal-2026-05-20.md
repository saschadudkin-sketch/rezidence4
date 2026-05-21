# Pilot Readiness Rehearsal — 2026-05-20

Status: local baseline green; live/staging pilot sign-off blocked.

Scope: post-Phase 5 browser rehearsal, package intake/pickup E2E, service execution E2E, and strict release gate packaging.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `npm run verify:strict` | Passed | Local evidence captured at `artifacts/release-gates/verify-strict.json`. |
| `npm run release:gate:check` | Passed | Runtime evidence under `artifacts/release-gates/` is fresh enough for the local gate. |
| `npm run pilot:training-pack` | Passed | DH-61 baseline docs/scripts are registered. |
| `npm run pilot:readiness` | Passed | Pilot rollout baseline evidence is registered. |
| `npm run russia:readiness` | Passed | Baseline Russia readiness evidence is registered. |
| `npm run russia:readiness -- --require-live --live-dir artifacts/russia-readiness` | Failed | Live/staging evidence packet is missing. |
| `npm run tenant:restore-drill:preflight` | Failed | Backup files are stale: 135.2h old, max allowed is 48h. |

## Green Baseline

- Browser-backed v1 access E2E passes.
- Browser-backed v1 packages E2E passes.
- Browser-backed v1 service execution E2E passes.
- Frontend lint, typecheck, contract coverage, enum drift, OpenAPI schema drift, tests and build pass through `verify:strict`.
- Backend tests and v1 property-scope audit pass through `verify:strict`.
- Release gate metadata/runtime matrix is wired and currently passes locally.

## Blocking Gaps Before Pilot Sign-Off

The strict Russia readiness gate requires retained live/staging JSON evidence under `artifacts/russia-readiness/`. That directory is intentionally ignored by Git, so release owners must attach it to the release packet or staging evidence store.

Missing files:

- `dh55-ownership-transfer.json`
- `dh56-privacy-compliance.json`
- `dh57-provider-delivery.json`
- `dh58-gis-oss-package.json`
- `dh59-field-rollout.json`
- `dh60-sensitive-report.json`
- `dh61-training-pack.json`
- `staging-verify-strict.json`
- `staging-restore-drill.json`

Restore preflight is also blocked because the current local backup files are stale:

- `backups/residenze_latest.sql.gz`: 135.2h old
- `backups/platform_latest.sql.gz`: 135.2h old
- `backups/zamoskv_latest.sql.gz`: 135.2h old

## Go/No-Go

No-go for real pilot sign-off until:

1. Fresh staging/prod-candidate backups exist and `npm run tenant:restore-drill:preflight` passes.
2. A real `npm run tenant:restore-drill` result is captured for staging/prod-candidate.
3. `artifacts/russia-readiness/` contains the DH-55 through DH-61 evidence files plus staging `verify:strict` and restore-drill evidence.
4. `npm run russia:readiness -- --require-live --live-dir artifacts/russia-readiness` passes.

Use `npm run tenant:backup-restore:evidence -- --write --refresh --preflight --drill --environment <staging|prod-candidate> --backup-reference <uri> --restore-target <target>` to refresh backup files, run restore preflight/drill and capture release-gate restore artifacts.

Use `npm run russia:readiness:evidence -- --write --environment <staging|prod-candidate> --property-slug <slug> --captured-by <owner> --log-reference <uri> --backup-reference <uri> --restore-target <target>` to generate the two staging command evidence files from matching release-gate artifacts. The command refuses to promote local artifacts to staging evidence.

Local engineering readiness is green; operational release readiness is blocked on live evidence, not on the v1 application code path.
