# DomHub — Russia Readiness Evidence Capture

Date: 2026-05-13
Status: Draft
Owner: QA And Release / Ops And Enablement

## 1. Purpose

This runbook defines the retained JSON evidence required before a Russia
production pilot can pass the strict readiness gate:

```bash
npm run russia:readiness -- --require-live
```

The default retained evidence directory is:

```text
artifacts/russia-readiness/
```

`artifacts/` is intentionally ignored by Git. Release owners keep these files
with the release packet or staging evidence store, not in source control.

## 2. Required Files

The strict gate expects these files:

| File | Evidence scope |
|---|---|
| `dh55-ownership-transfer.json` | Ownership transfer, offboarding report and notification preference cascade |
| `dh56-privacy-compliance.json` | DSAR workflow, privacy readiness and no-biometrics guard |
| `dh57-provider-delivery.json` | Emergency provider delivery and notification evidence |
| `dh58-gis-oss-package.json` | GIS/OSS export package with non-authoritative boundary |
| `dh59-field-rollout.json` | SKUD/provider field rollout or provider failure drill |
| `dh60-sensitive-report.json` | Sensitive-action report, review and anti-abuse evidence |
| `dh61-training-pack.json` | Pilot operations training acceptance |
| `staging-verify-strict.json` | `npm run verify:strict` result from staging/prod-candidate |
| `staging-restore-drill.json` | `npm run tenant:restore-drill` result from staging/prod-candidate |

## 3. Common JSON Contract

Each file must be a JSON object with:

```json
{
  "schema_version": 1,
  "dh": "DH-55",
  "environment": "staging",
  "captured_at": "2026-05-13T10:00:00.000Z",
  "captured_by": "release.owner@example.com",
  "source": {
    "type": "api",
    "endpoint": "/api/v1/residents/ownership-transfers/transfer-123"
  },
  "result": {
    "status": "passed",
    "summary": "Release review accepted the retained evidence."
  },
  "evidence": {
    "property_slug": "pilot-property"
  },
  "pii_policy": "no_personal_data_embedded"
}
```

Allowed `environment` values are `staging`, `prod-candidate`, `pilot` and
`production`. Local, sample, template and TODO values do not satisfy strict
readiness. `source` must include at least one of `command`, `endpoint`,
`report_uri`, `runbook`, `artifact_url` or `request_id`.

Allowed `result.status` values are `passed`, `accepted`, `completed`, `green`
and `waived`. A waived item must also include:

```json
{
  "waiver": {
    "reason": "Why release can proceed",
    "risk": "Known release risk",
    "owner": "Named owner",
    "follow_up_ticket": "DH-000"
  }
}
```

## 4. Evidence Keys By File

The strict gate also validates file-specific keys under `evidence`:

| File | Required `evidence` keys |
|---|---|
| `dh55-ownership-transfer.json` | `property_slug`, `ownership_transfer_id`, `offboarding_report_id`, `notification_cascade_evidence` |
| `dh56-privacy-compliance.json` | `property_slug`, `dsar_request_id`, `privacy_readiness_report_id`, `no_biometrics_guard_checked` |
| `dh57-provider-delivery.json` | `property_slug`, `emergency_request_id`, `provider_delivery_evidence_id`, `notification_provider` |
| `dh58-gis-oss-package.json` | `property_slug`, `export_package_id`, `document_registry_id`, `legally_authoritative` |
| `dh59-field-rollout.json` | `property_slug`, `provider_config_id`, `field_rollout_evidence_id`, `drill_type` |
| `dh60-sensitive-report.json` | `property_slug`, `report_evidence_id`, `review_report_id`, `anti_abuse_summary_id` |
| `dh61-training-pack.json` | `property_slug`, `training_date`, `accepted_by`, `open_waivers` |
| `staging-verify-strict.json` | `property_slug`, `command`, `exit_code`, `log_reference` |
| `staging-restore-drill.json` | `property_slug`, `command`, `exit_code`, `backup_reference`, `restore_target` |

For `dh58-gis-oss-package.json`, `evidence.legally_authoritative` must be
`false`. For the staging command files, `evidence.exit_code` must be `0`.

## 5. Capture Procedure

1. Run the DH-55 through DH-61 workflows against staging, prod-candidate or the
   pilot property.
2. Store only identifiers, command names, timestamps and links to external
   evidence. Do not embed resident personal data, vehicle plates, phone numbers
   or raw document contents.
3. Save the JSON files under `artifacts/russia-readiness/`.

Recommended capture flow: collect the retained live/staging identifiers in one
manifest and let the validator write the strict root files:

```bash
npm run russia:readiness:live-evidence -- \
  --write \
  --init-manifest \
  --manifest artifacts/russia-readiness/live-evidence-manifest.json \
  --environment staging \
  --property-slug zamoskv \
  --captured-by <release-owner>
```

The initialized manifest contains `TODO` placeholders on purpose. It cannot be
promoted into strict evidence until those placeholders are replaced with real
staging/pilot IDs, source endpoints or report URIs. Existing manifests are not
overwritten unless `--force` is passed.
Each `items.<DH>.capture_hint` lists the expected API or runbook source, but it
is not promoted to strict evidence. Copy only verified live/staging identifiers
from the workflow result into `source`, `result` and `evidence`.

After filling the manifest, dry-run validation first:

```bash
npm run russia:readiness:live-evidence -- \
  --manifest artifacts/russia-readiness/live-evidence-manifest.json
```

Then write the strict root files:

```bash
npm run russia:readiness:live-evidence -- \
  --write \
  --manifest artifacts/russia-readiness/live-evidence-manifest.json
```

### DH-58 GIS/OSS Artifact Helper

For the GIS/OSS readiness item, download the JSON returned by:

```text
GET /api/v1/gis-oss/export-packages/:packageId/artifact?property_id=<property_id>
```

Then merge it into the manifest:

```bash
npm run russia:readiness:live-evidence -- \
  --write \
  --manifest artifacts/russia-readiness/live-evidence-manifest.json \
  --dh58-artifact artifacts/russia-readiness/dh58-gis-oss-artifact.json \
  --document-registry-id <external-or-operational-document-registry-id>
```

The helper verifies the artifact format and non-authoritative boundary. It still
requires `--document-registry-id`; that identifier must come from the retained
operator document registry or release evidence store, not from guesswork. Check
only DH-58 afterward with:

```bash
npm run russia:readiness:live-evidence -- \
  --manifest artifacts/russia-readiness/live-evidence-manifest.json \
  --dh DH-58
```

The manifest is not a waiver and does not mark work complete by itself. The
script validates every DH-55 through DH-61 payload with the same strict contract
used by `npm run russia:readiness -- --require-live`; if any required identifier
or source reference is missing, it writes nothing.

Minimal manifest shape:

```json
{
  "schema_version": 1,
  "environment": "staging",
  "property_slug": "zamoskv",
  "captured_by": "release.owner@example.com",
  "captured_at": "2026-05-21T10:00:00.000Z",
  "items": {
    "DH-55": {
      "capture_hint": {
        "source_type": "api",
        "source_refs": [
          "POST /api/v1/residents/:id/transfer-ownership",
          "GET /api/v1/residents/offboarding-report?property_id=<property_id>"
        ],
        "result_summary": "Ownership transfer/offboarding evidence accepted for release review."
      },
      "source": {
        "type": "api",
        "endpoint": "/api/v1/residents/ownership-transfers/<id>"
      },
      "result": {
        "status": "passed",
        "summary": "Ownership transfer/offboarding evidence accepted."
      },
      "evidence": {
        "ownership_transfer_id": "<id>",
        "offboarding_report_id": "<id>",
        "notification_cascade_evidence": "<id-or-report-uri>"
      }
    }
  }
}
```

Include equivalent `items` entries for `DH-56` through `DH-61` before running
with `--write`. The script can be dry-run without `--write`.

For a full staging/prod-candidate packet, use the orchestrator:

```bash
npm run pilot:release-packet -- \
  --environment staging \
  --property-slug <pilot-property> \
  --captured-by <release-owner> \
  --log-reference <ci-or-release-log-uri> \
  --backup-reference <backup-set-uri-or-id> \
  --restore-target <restore-drill-target>
```

It runs strict verification, backup refresh/restore drill, command evidence
generation and strict live Russia readiness in order. It stops on the first
failure.

Manual step-by-step flow:

4. Run strict verification in the same environment that will be used for the
   retained release packet:

```bash
npm run verify:strict -- --environment staging
```

This writes `artifacts/release-gates/verify-strict.json` with
`environment: "staging"`. The Russia evidence generator refuses to promote a
`local` strict artifact into staging/prod-candidate evidence.

5. Refresh backup/restore runtime evidence for staging/prod-candidate:

```bash
npm run tenant:backup-restore:evidence -- \
  --write \
  --refresh \
  --preflight \
  --drill \
  --environment staging \
  --backup-reference <backup-set-uri-or-id> \
  --restore-target <restore-drill-target>
```

6. Generate command evidence from retained staging/prod-candidate release-gate
   artifacts:

```bash
npm run russia:readiness:evidence -- \
  --write \
  --environment staging \
  --property-slug <pilot-property> \
  --captured-by <release-owner> \
  --log-reference <ci-or-release-log-uri> \
  --backup-reference <backup-set-uri-or-id> \
  --restore-target <restore-drill-target>
```

The generator refuses to convert `local` runtime artifacts into `staging` or
`prod-candidate` evidence. Source artifacts under `artifacts/release-gates/`
must already have the same `environment` as the target packet.

Use `--templates` with the command above, or `--templates-only` before command
evidence exists, to write DH-55 through DH-61 JSON templates under
`artifacts/russia-readiness/templates/`. Templates are intentionally not written
to the strict root filenames because they are not live evidence.

7. Run:

```bash
npm run russia:readiness -- --require-live
```

8. Attach the strict gate output and the retained JSON packet to the release
   review.
