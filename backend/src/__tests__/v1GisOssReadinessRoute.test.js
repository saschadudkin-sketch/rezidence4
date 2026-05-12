'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

jest.mock('../v1/services/gisOssReadinessService', () => ({
  LEGAL_BOUNDARY_NOTICE: 'GIS/OSS readiness only; not certified filing or legally significant electronic voting.',
  buildGisOssExportArtifact: jest.fn(),
  createGisOssExportPackage: jest.fn(),
  getGisOssExportPackage: jest.fn(),
  isGisOssReadinessServiceError: jest.fn((err) => err?.name === 'GisOssReadinessServiceError'),
  listGisOssExportPackages: jest.fn(),
}));

const db = require('../db');
const service = require('../v1/services/gisOssReadinessService');
const router = require('../v1/routes/gisOssReadiness');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/gis-oss', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
});

describe('v1 GIS/OSS readiness route', () => {
  test('authenticated users can read the legal boundary notice', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get('/api/v1/gis-oss/boundary');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      legally_authoritative: false,
      certified_submission: false,
    });
    expect(res.body.out_of_scope).toContain('certified_gis_zhkh_filing');
  });

  test('property admin can generate an export package', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.createGisOssExportPackage.mockResolvedValue({
      export_package: { id: PACKAGE_ID, package_type: 'oss_readiness' },
      payload: { legal_boundary: { legally_authoritative: false } },
      boundary_notice: service.LEGAL_BOUNDARY_NOTICE,
    });

    const res = await supertest(buildApp())
      .post('/api/v1/gis-oss/export-packages')
      .send({ property_id: PROPERTY_ID, title: 'OSS readiness May' });

    expect(res.status).toBe(201);
    expect(res.body.export_package.id).toBe(PACKAGE_ID);
    expect(service.createGisOssExportPackage).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      input: { property_id: PROPERTY_ID, title: 'OSS readiness May' },
      user: mockCurrentUser,
      ipAddress: expect.any(String),
    });
  });

  test('security cannot generate export packages', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .post('/api/v1/gis-oss/export-packages')
      .send({ property_id: PROPERTY_ID, title: 'OSS readiness May' });

    expect(res.status).toBe(403);
    expect(service.createGisOssExportPackage).not.toHaveBeenCalled();
  });

  test('property admin can list and read packages with boundary notice', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.listGisOssExportPackages.mockResolvedValue([{ id: PACKAGE_ID }]);
    service.getGisOssExportPackage.mockResolvedValue({
      id: PACKAGE_ID,
      export_payload: { format_version: 'gis_oss_readiness.v1' },
    });

    const listRes = await supertest(buildApp())
      .get(`/api/v1/gis-oss/export-packages?property_id=${PROPERTY_ID}&package_type=gis_zhkh&limit=5`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.export_packages).toEqual([{ id: PACKAGE_ID }]);
    expect(service.listGisOssExportPackages).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      packageType: 'gis_zhkh',
      limit: '5',
    });

    const getRes = await supertest(buildApp())
      .get(`/api/v1/gis-oss/export-packages/${PACKAGE_ID}?property_id=${PROPERTY_ID}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      export_package: { id: PACKAGE_ID },
      payload: { format_version: 'gis_oss_readiness.v1' },
      boundary_notice: service.LEGAL_BOUNDARY_NOTICE,
    });
    expect(service.getGisOssExportPackage).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      packageId: PACKAGE_ID,
    });
  });

  test('property admin can download package artifact JSON with checksum headers', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    const exportPackage = {
      id: PACKAGE_ID,
      export_payload: { format_version: 'gis_oss_readiness.v1' },
    };
    service.getGisOssExportPackage.mockResolvedValue(exportPackage);
    service.buildGisOssExportArtifact.mockReturnValue({
      filename: 'gis-oss-readiness.json',
      content_type: 'application/vnd.domhub.gis-oss-readiness+json',
      sha256: 'b'.repeat(64),
      serialized: JSON.stringify({ artifact_format_version: 'gis_oss_package_artifact.v1' }),
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/gis-oss/export-packages/${PACKAGE_ID}/artifact?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.domhub.gis-oss-readiness+json');
    expect(res.headers['content-disposition']).toBe('attachment; filename="gis-oss-readiness.json"');
    expect(res.headers['x-artifact-sha256']).toBe('b'.repeat(64));
    expect(res.body).toEqual({ artifact_format_version: 'gis_oss_package_artifact.v1' });
    expect(service.getGisOssExportPackage).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      packageId: PACKAGE_ID,
    });
    expect(service.buildGisOssExportArtifact).toHaveBeenCalledWith(exportPackage);
  });

  test('rejects invalid export package id before service call', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get(`/api/v1/gis-oss/export-packages/not-a-uuid?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(400);
    expect(service.getGisOssExportPackage).not.toHaveBeenCalled();
  });
});
