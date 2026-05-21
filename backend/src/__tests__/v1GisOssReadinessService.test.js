'use strict';

const {
  LEGAL_BOUNDARY_NOTICE,
  buildGisOssExportArtifact,
  createGisOssExportPackage,
  getGisOssExportPackage,
  listGisOssExportPackages,
} = require('../v1/services/gisOssReadinessService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const ANNOUNCEMENT_ID = '33333333-3333-4333-8333-333333333333';
const PACKAGE_ID = '44444444-4444-4444-8444-444444444444';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

describe('GisOssReadinessService', () => {
  test('creates readiness export package with explicit non-authoritative boundary', async () => {
    const document = {
      id: DOCUMENT_ID,
      title: 'OSS notice',
      category: 'legal',
      tag: 'oss',
      file_url: '/uploads/oss/notice.pdf',
      file_mime: 'application/pdf',
      file_size_bytes: 1234,
      is_public: true,
      published_at: '2026-05-10T10:00:00.000Z',
      updated_at: '2026-05-10T11:00:00.000Z',
    };
    const announcement = {
      id: ANNOUNCEMENT_ID,
      title: 'Meeting announcement',
      is_urgent: false,
      category: 'notice',
      audience_type: 'all',
      starts_at: '2026-05-12T09:00:00.000Z',
      expires_at: null,
      published_at: '2026-05-10T12:00:00.000Z',
      updated_at: '2026-05-10T12:00:00.000Z',
    };
    const queryable = makeQueryable((sql, params) => {
      if (sql.includes('FROM documents_v2')) return Promise.resolve({ rows: [document] });
      if (sql.includes('FROM announcements_v2')) return Promise.resolve({ rows: [announcement] });
      if (sql.includes('INSERT INTO gis_oss_export_packages')) {
        return Promise.resolve({
          rows: [{
            id: PACKAGE_ID,
            property_id: params[0],
            package_type: params[1],
            title: params[2],
            period_start: params[3],
            period_end: params[4],
            document_ids: params[5],
            announcement_ids: params[6],
            protocol_files: JSON.parse(params[7]),
            operational_record_refs: JSON.parse(params[8]),
            export_payload: JSON.parse(params[9]),
            boundary_notice: params[10],
            legally_authoritative: false,
            certified_submission: false,
          }],
        });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createGisOssExportPackage(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      ipAddress: '127.0.0.1',
      input: {
        package_type: 'oss_readiness',
        title: 'OSS readiness May',
        period_start: '2026-05-01',
        period_end: '2026-05-31',
        document_ids: [DOCUMENT_ID],
        announcement_ids: [ANNOUNCEMENT_ID],
        protocol_files: [{
          label: 'Signed protocol',
          file_url: '/uploads/oss/protocol.pdf',
          file_mime: 'application/pdf',
        }],
        operational_record_refs: [{ type: 'request', id: 'REQ-1', note: 'elevator repair' }],
      },
    });

    expect(result.export_package).toMatchObject({
      id: PACKAGE_ID,
      package_type: 'oss_readiness',
      legally_authoritative: false,
      certified_submission: false,
      boundary_notice: LEGAL_BOUNDARY_NOTICE,
    });
    expect(result.payload.legal_boundary).toMatchObject({
      legally_authoritative: false,
      certified_submission: false,
    });
    expect(result.payload.packaging).toMatchObject({
      format_version: 'gis_oss_artifact_manifest.v1',
      artifact_content_type: 'application/vnd.domhub.gis-oss-readiness+json',
    });
    expect(result.payload.packaging.artifact_filename)
      .toMatch(/^gis-oss-oss-readiness-oss-readiness-may-\d{4}-\d{2}-\d{2}-11111111\.json$/);
    expect(result.payload.packaging.manifest.package_payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.payload.packaging.manifest.material_counts).toEqual({
      documents: 1,
      announcements: 1,
      protocol_files: 1,
      operational_record_refs: 1,
    });
    expect(result.payload.packaging.manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'payload.json', role: 'package_payload' }),
      expect.objectContaining({ path: `materials/documents/${DOCUMENT_ID}.json`, role: 'document_metadata' }),
      expect.objectContaining({ path: `materials/announcements/${ANNOUNCEMENT_ID}.json`, role: 'announcement_metadata' }),
      expect.objectContaining({ role: 'protocol_file_reference', source_url: '/uploads/oss/protocol.pdf' }),
      expect.objectContaining({ role: 'operational_record_reference' }),
    ]));
    expect(result.payload.operational_evidence.source_validation).toEqual({
      documents_property_scoped: true,
      announcements_property_scoped: true,
      protocol_files_local_uploads_only: true,
    });
    expect(result.payload.integration_path).toMatchObject({
      current_mode: 'readiness_package_only',
      certified_submission_supported: false,
    });
    expect(result.payload.materials.documents).toEqual([
      expect.objectContaining({ id: DOCUMENT_ID, title: 'OSS notice' }),
    ]);
    expect(result.payload.materials.announcements).toEqual([
      expect.objectContaining({ id: ANNOUNCEMENT_ID, title: 'Meeting announcement' }),
    ]);

    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gis_oss_export_packages'));
    expect(insert[1][1]).toBe('oss_readiness');
    expect(JSON.parse(insert[1][9]).legal_boundary.out_of_scope).toContain('certified_gis_zhkh_filing');
    expect(JSON.parse(insert[1][9]).packaging.manifest.files).toEqual(expect.any(Array));

    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[0]).toContain('$4::uuid');
    expect(audit[0]).toContain('$4::text');
    expect(audit[1][4]).toBe('gis_oss.export_package.generated');
    expect(JSON.parse(audit[1][5])).toMatchObject({
      document_count: 1,
      announcement_count: 1,
      legally_authoritative: false,
      certified_submission: false,
    });
  });

  test('rejects protocol files that are not local uploads', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await expect(createGisOssExportPackage(queryable, {
      propertyId: PROPERTY_ID,
      input: {
        title: 'Bad package',
        protocol_files: [{ label: 'External', file_url: 'https://example.test/protocol.pdf' }],
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'protocol_files[0].file_url must be a local /uploads/ URL',
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('fails when requested documents are outside the property scope', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM documents_v2')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(createGisOssExportPackage(queryable, {
      propertyId: PROPERTY_ID,
      input: {
        title: 'OSS package',
        document_ids: [DOCUMENT_ID],
      },
    })).rejects.toMatchObject({
      status: 404,
      message: 'One or more documents were not found in this property',
    });
  });

  test('lists and gets packages within property scope', async () => {
    const row = {
      id: PACKAGE_ID,
      property_id: PROPERTY_ID,
      package_type: 'gis_zhkh',
      export_payload: { ok: true },
    };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM gis_oss_export_packages')) return Promise.resolve({ rows: [row] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(listGisOssExportPackages(queryable, {
      propertyId: PROPERTY_ID,
      packageType: 'gis_zhkh',
      limit: 500,
    })).resolves.toEqual([row]);
    expect(queryable.query.mock.calls[0][1]).toEqual([PROPERTY_ID, 'gis_zhkh', 200]);

    await expect(getGisOssExportPackage(queryable, {
      propertyId: PROPERTY_ID,
      packageId: PACKAGE_ID,
    })).resolves.toBe(row);
    expect(queryable.query.mock.calls[1][1]).toEqual([PROPERTY_ID, PACKAGE_ID]);
  });

  test('builds deterministic JSON artifact envelope for stored package payload', () => {
    const exportPackage = {
      id: PACKAGE_ID,
      property_id: PROPERTY_ID,
      package_type: 'gis_zhkh',
      title: 'GIS package',
      status: 'generated',
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      export_payload: {
        format_version: 'gis_oss_readiness.v1',
        packaging: {
          artifact_filename: 'gis-oss-gis-zhkh-gis-package-2026-05-11-11111111.json',
          artifact_content_type: 'application/vnd.domhub.gis-oss-readiness+json',
          manifest: { package_payload_sha256: 'a'.repeat(64), files: [] },
        },
        legal_boundary: {
          legally_authoritative: false,
          certified_submission: false,
          notice: LEGAL_BOUNDARY_NOTICE,
        },
      },
      boundary_notice: LEGAL_BOUNDARY_NOTICE,
      generated_by_uid: 'admin-1',
      generated_at: '2026-05-11T10:00:00.000Z',
    };

    const artifact = buildGisOssExportArtifact(exportPackage);

    expect(artifact.filename).toBe('gis-oss-gis-zhkh-gis-package-2026-05-11-11111111.json');
    expect(artifact.content_type).toBe('application/vnd.domhub.gis-oss-readiness+json');
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(artifact.serialized)).toMatchObject({
      artifact_format_version: 'gis_oss_package_artifact.v1',
      export_package: {
        id: PACKAGE_ID,
        legally_authoritative: false,
        certified_submission: false,
      },
      manifest: { package_payload_sha256: 'a'.repeat(64) },
      payload: { format_version: 'gis_oss_readiness.v1' },
    });
  });
});
