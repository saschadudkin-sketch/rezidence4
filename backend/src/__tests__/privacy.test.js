'use strict';

jest.mock('../db');
jest.mock('../sse', () => ({ broadcastUserDelete: jest.fn() }));
let mockAuthUser = {
  uid: 'u1',
  phone: '+79001234567',
  role: 'owner',
  name: 'Resident',
};
jest.mock('../middleware/auth', () => {
  const mw = (req, res, next) => {
    req.user = mockAuthUser;
    next();
  };
  mw.invalidateUserActiveCache = jest.fn().mockResolvedValue(undefined);
  mw.markTokenRevoked = jest.fn().mockResolvedValue(undefined);
  return mw;
});

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const db = require('../db');
const requireAuth = require('../middleware/auth');
const { broadcastUserDelete } = require('../sse');
const privacyRouter = require('../routes/privacy');

function buildApp({ tenantDb } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  if (tenantDb) {
    app.use((req, res, next) => {
      req.db = tenantDb;
      next();
    });
  }
  app.use('/api/v1/privacy', privacyRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUser = {
    uid: 'u1',
    phone: '+79001234567',
    role: 'owner',
    name: 'Resident',
  };
  db._mockClient.query.mockReset();
  db._mockClient.release.mockReset();
  db.pool.connect.mockClear();
  db.query.mockReset();
});

describe('GET /api/v1/privacy/consent', () => {
  it('reads consent state from tenant db when req.db is attached', async () => {
    const tenantDb = {
      query: jest.fn().mockResolvedValue({
        rows: [{ consent_accepted_at: null, consent_version: null }],
      }),
      connect: jest.fn(),
    };
    const app = buildApp({ tenantDb });

    const res = await request(app).get('/api/v1/privacy/consent');

    expect(res.status).toBe(200);
    expect(res.body.needsAcceptance).toBe(true);
    expect(tenantDb.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM users'),
      ['u1'],
    );
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('DH-56 data subject request workflow', () => {
  const propertyId = '11111111-1111-4111-8111-111111111111';

  it('lets residents submit their own data subject request', async () => {
    const tenantDb = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          property_id: propertyId,
          request_type: 'export',
          status: 'pending',
          subject_uid: 'u1',
          subject_resident_id: null,
          submitted_by_uid: 'u1',
          submitted_by_role: 'owner',
          request_payload: { details: 'copy', source: 'resident_ui' },
          export_payload: {},
          retention_decision: {},
        }],
      }),
      connect: jest.fn(),
    };
    const app = buildApp({ tenantDb });

    const res = await request(app)
      .post('/api/v1/privacy/data-subject-requests')
      .send({ property_id: propertyId, type: 'export', details: 'copy' });

    expect(res.status).toBe(201);
    expect(res.body.request.request_type).toBe('export');
    expect(tenantDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO privacy_data_subject_requests'),
      expect.arrayContaining([propertyId, 'export', 'u1']),
    );
  });

  it('prevents residents from submitting DSARs for another subject uid', async () => {
    const tenantDb = { query: jest.fn(), connect: jest.fn() };
    const app = buildApp({ tenantDb });

    const res = await request(app)
      .post('/api/v1/privacy/data-subject-requests')
      .send({ property_id: propertyId, type: 'export', subject_uid: 'u2' });

    expect(res.status).toBe(403);
    expect(tenantDb.query).not.toHaveBeenCalled();
  });

  it('lets admins complete DSARs with retention evidence', async () => {
    mockAuthUser = {
      uid: 'admin-1',
      phone: '+79001230000',
      role: 'admin',
      name: 'Admin',
    };
    const requestId = '33333333-3333-4333-8333-333333333333';
    const tenantDb = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: requestId,
          property_id: propertyId,
          request_type: 'delete',
          status: 'completed',
          subject_uid: 'u1',
          request_payload: {},
          export_payload: {},
          retention_decision: { anonymized: true },
          processed_by_uid: 'admin-1',
          processed_at: '2026-05-13T12:00:00.000Z',
        }],
      }),
      connect: jest.fn(),
    };
    const app = buildApp({ tenantDb });

    const res = await request(app)
      .post(`/api/v1/privacy/data-subject-requests/${requestId}/complete`)
      .send({ status: 'completed', retention_decision: { anonymized: true } });

    expect(res.status).toBe(200);
    expect(res.body.request.retention_decision.anonymized).toBe(true);
    expect(tenantDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE privacy_data_subject_requests'),
      expect.arrayContaining([requestId, 'completed', 'admin-1']),
    );
  });

  it('records and summarizes admin compliance evidence', async () => {
    mockAuthUser = {
      uid: 'admin-1',
      phone: '+79001230000',
      role: 'admin',
      name: 'Admin',
    };
    const evidenceRow = {
      id: '44444444-4444-4444-8444-444444444444',
      property_id: propertyId,
      evidence_type: 'no_biometrics_release_guard',
      status: 'reviewed',
      summary: 'checked',
      evidence: { checked: true },
      recorded_by_uid: 'admin-1',
    };
    const tenantDb = {
      query: jest.fn((sql) => {
        if (sql.includes('INSERT INTO privacy_compliance_evidence')) {
          return Promise.resolve({ rows: [evidenceRow] });
        }
        if (sql.includes('FROM privacy_data_subject_requests')) {
          return Promise.resolve({ rows: [{ request_type: 'export', status: 'completed', count: 1 }] });
        }
        if (sql.includes('FROM privacy_compliance_evidence')) {
          return Promise.resolve({ rows: [evidenceRow] });
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: jest.fn(),
    };
    const app = buildApp({ tenantDb });

    const evidenceRes = await request(app)
      .post('/api/v1/privacy/compliance-evidence')
      .send({
        property_id: propertyId,
        evidence_type: 'no_biometrics_release_guard',
        status: 'reviewed',
        summary: 'checked',
        evidence: { checked: true },
      });
    const readinessRes = await request(app)
      .get('/api/v1/privacy/readiness')
      .query({ property_id: propertyId });

    expect(evidenceRes.status).toBe(201);
    expect(readinessRes.status).toBe(200);
    expect(readinessRes.body.readiness.controls.no_biometrics_release_guard).toBe(true);
  });
});

describe('POST /api/v1/privacy/delete-account', () => {
  it('anonymizes account, revokes refresh tokens, invalidates active cache and clears current auth cookies', async () => {
    const tenantClient = {
      query: jest.fn((sql) => {
        if (/INSERT INTO privacy_deletion_requests/i.test(sql)) {
          return Promise.resolve({ rows: [{ id: 'audit-1' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: jest.fn(),
    };
    const tenantDb = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(tenantClient),
    };
    const app = buildApp({ tenantDb });

    const res = await request(app)
      .post('/api/v1/privacy/delete-account')
      .set('Cookie', ['token=access-token', 'refreshToken=refresh-token'])
      .send({ reason: 'move out' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true, auditId: 'audit-1' });
    expect(tenantDb.connect).toHaveBeenCalledTimes(1);
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(tenantClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(tenantClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM refresh_tokens WHERE uid=$1'),
      ['u1'],
    );
    expect(tenantClient.query).toHaveBeenCalledWith('COMMIT');
    expect(tenantClient.release).toHaveBeenCalledTimes(1);
    expect(requireAuth.invalidateUserActiveCache).toHaveBeenCalledWith('u1');
    expect(broadcastUserDelete).toHaveBeenCalledWith('u1');

    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((cookie) => cookie.startsWith('token=;'))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('refreshToken=;') && cookie.includes('Path=/api'))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('rezi_at=;'))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('rezi_rt=;'))).toBe(true);
  });
});
