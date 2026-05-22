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

const db = require('../db');
const videoEvidenceRouter = require('../v1/routes/videoEvidence');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const INCIDENT_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_LOG_ID = '33333333-3333-4333-8333-333333333333';
const CAMERA_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';
const STAFF_ID = '66666666-6666-4666-8666-666666666666';
const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
const VIDEO_PROVIDER_ID = '99999999-9999-4999-8999-999999999999';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', videoEvidenceRouter);
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

function evidenceRow(overrides = {}) {
  return {
    id: EVIDENCE_ID,
    property_id: PROPERTY_ID,
    access_incident_id: INCIDENT_ID,
    visit_log_id: VISIT_LOG_ID,
    camera_device_id: CAMERA_ID,
    provider_config_id: PROVIDER_ID,
    video_provider_config_id: VIDEO_PROVIDER_ID,
    evidence_type: 'snapshot',
    status: 'linked',
    snapshot_url: 'https://vms.example/snapshot/1.jpg',
    sensitivity: 'restricted',
    biometric_identity_matching: false,
    created_by_staff_id: STAFF_ID,
    ...overrides,
  };
}

function videoProviderRow(overrides = {}) {
  return {
    id: VIDEO_PROVIDER_ID,
    property_id: PROPERTY_ID,
    provider: 'trassir',
    display_name: 'TRASSIR main',
    status: 'active',
    base_url: 'https://trassir.example:8080',
    auth_ref: 'vault://video/trassir-main',
    config_json: {},
    capabilities: ['snapshot', 'archive_export'],
    health_status: 'unknown',
    created_by: STAFF_ID,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 video evidence route', () => {
  test('disabled video evidence gate does not block unrelated root-mounted v1 paths', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.property = { resolvedFlags: { video_evidence: false } };
      next();
    });
    app.use('/api/v1', videoEvidenceRouter);
    app.use((_req, res) => res.status(404).json({ error: 'not found' }));

    const res = await supertest(app)
      .get('/api/v1/gis-oss/boundary');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not found');
  });

  test('disabled video evidence gate still hides video endpoints', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.property = { resolvedFlags: { video_evidence: false } };
      next();
    });
    app.use('/api/v1', videoEvidenceRouter);

    const res = await supertest(app)
      .get(`/api/v1/video-evidence/${EVIDENCE_ID}?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('security can attach evidence to an incident and writes audit', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_incidents')) {
        return Promise.resolve({ rows: [{ id: INCIDENT_ID, property_id: PROPERTY_ID, related_visit_log_id: VISIT_LOG_ID }] });
      }
      if (sql.includes('FROM visit_logs_v2')) {
        return Promise.resolve({ rows: [{ id: VISIT_LOG_ID, property_id: PROPERTY_ID }] });
      }
      if (sql.includes('FROM skud_hardware_devices')) {
        return Promise.resolve({ rows: [{ id: CAMERA_ID, property_id: PROPERTY_ID, provider_config_id: PROVIDER_ID, device_class: 'camera' }] });
      }
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_evidence_references')) return Promise.resolve({ rows: [evidenceRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-incidents/${INCIDENT_ID}/video-evidence`)
      .send({
        property_id: PROPERTY_ID,
        camera_device_id: CAMERA_ID,
        snapshot_url: 'https://vms.example/snapshot/1.jpg',
      });

    expect(res.status).toBe(201);
    expect(res.body.evidence.id).toBe(EVIDENCE_ID);
    const audit = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('video.evidence.linked');
  });

  test('property admin can register a VMS provider', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_provider_configs')) return Promise.resolve({ rows: [videoProviderRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/video/providers')
      .send({
        property_id: PROPERTY_ID,
        provider: 'trassir',
        display_name: 'TRASSIR main',
        base_url: 'https://trassir.example:8080',
        auth_ref: 'vault://video/trassir-main',
      });

    expect(res.status).toBe(201);
    expect(res.body.provider.id).toBe(VIDEO_PROVIDER_ID);
  });

  test('security can fetch provider evidence for an incident', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_incidents')) {
        return Promise.resolve({ rows: [{ id: INCIDENT_ID, property_id: PROPERTY_ID, related_visit_log_id: VISIT_LOG_ID, created_at: '2026-05-10T10:00:00.000Z' }] });
      }
      if (sql.includes('FROM visit_logs_v2')) {
        return Promise.resolve({ rows: [{ id: VISIT_LOG_ID, property_id: PROPERTY_ID, access_point_id: '88888888-8888-4888-8888-888888888888', occurred_at: '2026-05-10T10:00:00.000Z' }] });
      }
      if (sql.includes('FROM skud_hardware_devices')) {
        return Promise.resolve({
          rows: [{
            id: CAMERA_ID,
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            video_provider_config_id: VIDEO_PROVIDER_ID,
            device_class: 'camera',
            access_point_id: '88888888-8888-4888-8888-888888888888',
            external_device_id: 'HTwUsj8U',
            metadata: {},
          }],
        });
      }
      if (sql.includes('FROM video_provider_configs')) return Promise.resolve({ rows: [videoProviderRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO video_evidence_references')) return Promise.resolve({ rows: [evidenceRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/access-incidents/${INCIDENT_ID}/video-evidence/fetch`)
      .send({
        property_id: PROPERTY_ID,
        window_before_seconds: 10,
        window_after_seconds: 20,
      });

    expect(res.status).toBe(201);
    expect(res.body.evidence.id).toBe(EVIDENCE_ID);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO video_evidence_references'));
    expect(insert[1][6]).toBe(VIDEO_PROVIDER_ID);
  });

  test('resident cannot access video evidence', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'resident', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get(`/api/v1/video-evidence/${EVIDENCE_ID}?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('opening an evidence reference records video.evidence.viewed audit', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM video_evidence_references')) return Promise.resolve({ rows: [evidenceRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/video-evidence/${EVIDENCE_ID}?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.evidence.id).toBe(EVIDENCE_ID);
    const audit = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('video.evidence.viewed');
  });
});
