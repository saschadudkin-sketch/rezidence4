# GIS/OSS Readiness Spec

Status: Draft
Scope: `DH-58` backend baseline for GIS ZhKH / OSS export readiness

## 1. Purpose

DomHub prepares a property-scoped export package for external GIS ZhKH and OSS work. The feature helps property admins collect documents, announcements, protocol files and operational references in one package.

This module is explicitly not a certified GIS ZhKH filing integration and not legally significant electronic OSS voting.

## 2. Data Model

`gis_oss_export_packages` stores immutable generated packages:

- `property_id`
- `package_type`: `gis_zhkh`, `oss_readiness`, `resident_notice`, `protocol_archive`
- `title`, `period_start`, `period_end`
- `document_ids`, `announcement_ids`
- `protocol_files`, `operational_record_refs`
- `export_payload`
- `boundary_notice`
- `legally_authoritative = false`
- `certified_submission = false`

The two legal boundary flags are CHECK-constrained to `false`.

## 3. API

Mounted at `/api/v1/gis-oss`.

Route gate: `gis_oss_readiness` feature flag. The flag is available only to the enterprise/integrations package layer.

- `GET /boundary`: returns the legal boundary notice.
- `GET /export-packages?property_id=&package_type=&limit=`: admin list.
- `POST /export-packages`: admin package generation.
- `GET /export-packages/:packageId?property_id=`: admin package detail.
- `GET /export-packages/:packageId/artifact?property_id=`: admin JSON artifact download.

Capabilities:

- `gis_oss.readiness.read`: property admin roles.
- `gis_oss.readiness.export`: property admin roles.

## 4. Export Payload

Payload version: `gis_oss_readiness.v1`.

The payload includes:

- package metadata and period;
- legal boundary block with `legally_authoritative: false`;
- selected document metadata;
- selected announcement metadata;
- protocol files limited to local `/uploads/` URLs;
- operational record references;
- packaging manifest with deterministic JSON artifact filename, payload checksum,
  material counts and file/reference entries;
- operational evidence for source-scope validation and operator review;
- future certified integration path markers, with certified submission disabled.

The package never sends data to GIS ZhKH and never casts or certifies an OSS vote.

## 5. Artifact Format

Artifact version: `gis_oss_package_artifact.v1`.

The artifact endpoint returns `application/vnd.domhub.gis-oss-readiness+json`
with `Content-Disposition: attachment`. The JSON envelope contains:

- package metadata;
- legal boundary block;
- manifest from the stored payload;
- operational evidence;
- integration path;
- full stored `gis_oss_readiness.v1` payload.

`X-Artifact-Sha256` exposes the SHA-256 of the serialized artifact. The
artifact is still readiness evidence only: it is not a GIS ZhKH certified filing
and not a legally significant OSS vote.

## 6. Audit

Package generation writes `gis_oss.export_package.generated` to `property_audit_log`.

The audit catalog classifies it as:

- canonical event: `integration.gis_oss.export_package.generated`
- category: `export`
- sensitivity: `restricted`
- review required: yes

## 7. Acceptance Criteria

- Property admins can generate and list readiness packages through `/api/v1/gis-oss`.
- Property admins have a v1 admin workspace at `/v1/admin/gis-oss`.
- Referenced documents and announcements must belong to the same property.
- Protocol file URLs must be local `/uploads/` URLs.
- Generated packages include manifest/checksum evidence and a downloadable JSON artifact.
- API responses always include boundary language.
- Database constraints prevent marking packages as legally authoritative or certified submissions.
- Tests cover migration shape, service validation, route authorization, admin UI smoke coverage and sensitive audit classification.

## 8. Open Questions

Resolved for MVP:

- Certified filing and legally significant electronic OSS voting are out of scope.
- Readiness JSON artifact packaging is in scope; binary ZIP bundling and
  certified provider submission remain later hardening steps.
