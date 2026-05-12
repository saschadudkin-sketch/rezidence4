# platform-v1 — Privacy Compliance Controls

Статус: Draft
Backlog: `DH-56 RU Personal Data Compliance Controls`

## 1. Scope

This module makes Russian pilot personal-data readiness executable for MVP/v2 Core:

- consent history is preserved through existing resident lifecycle ledgers;
- data subject requests are tracked as auditable DSAR workflow;
- export/delete/correct/restrict requests have explicit status, due date and resolution evidence;
- retention/deletion, data localization, ИСПДн readiness and no-biometrics checks are recorded as release evidence.

This is not a legal certification module and does not replace formal ИСПДн assessment.

## 2. Data Model

`privacy_data_subject_requests`

- `request_type`: `export`, `delete`, `correct`, `restrict`;
- `status`: `pending`, `in_progress`, `completed`, `rejected`, `cancelled`;
- subject binding: `subject_uid` and/or `subject_resident_id`;
- `request_payload`: intake details and correction payload;
- `export_payload`: generated/exported response snapshot;
- `retention_decision`: anonymization, deletion, correction or restriction outcome;
- `due_at`, `processed_at`, `processed_by_uid` for SLA/evidence review.

`privacy_compliance_evidence`

- `evidence_type`: `dsar_workflow`, `retention_sweep`, `data_localization`, `ispdn_readiness`, `no_biometrics_release_guard`, `consent_history`, `deletion_procedure`;
- `status`: `draft`, `ready`, `reviewed`, `blocked`;
- `summary`, `artifact_uri`, `evidence` for retained pilot/release artifacts.

## 3. API

Mounted under `/api/v1/privacy`:

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/data-subject-export` | resident/admin | Export current subject snapshot; admin may target `subject_resident_id`. |
| `GET` | `/data-subject-requests` | resident/admin | Resident sees own DSARs; admin sees property queue. |
| `POST` | `/data-subject-requests` | resident/admin | Create DSAR of type export/delete/correct/restrict. |
| `POST` | `/data-subject-requests/:id/complete` | admin | Resolve DSAR with export/retention evidence. |
| `GET` | `/compliance-evidence` | admin | List DH-56 evidence records. |
| `POST` | `/compliance-evidence` | admin | Record retention/localization/ИСПДн/no-biometrics evidence. |
| `GET` | `/readiness` | admin | Summarize DSAR counts and latest DH-56 evidence by control. |

## 4. Guardrails

- Residents cannot submit DSARs for another `subject_uid`.
- Non-admin export is bound to the authenticated subject.
- Video/camera evidence remains allowed only as non-biometric evidence references.
- `no_biometrics_release_guard` must be represented in release evidence before a Russia pilot.

## 5. Acceptance

- Given a resident requests export/delete/correct/restrict, when the request is submitted, then an auditable `privacy_data_subject_requests` row exists.
- Given an admin resolves a DSAR, when the request is completed/rejected/cancelled, then `processed_at`, processor, resolution and retention/export evidence are retained.
- Given a release candidate is reviewed, when DH-56 readiness is checked, then DSAR workflow, retention, localization, ИСПДн and no-biometrics evidence are visible through `/api/v1/privacy/readiness`.
- Given a biometric feature request appears, when release evidence is recorded, then MVP/v2 Core records `no_biometrics_release_guard` instead of enabling biometric identity matching.
