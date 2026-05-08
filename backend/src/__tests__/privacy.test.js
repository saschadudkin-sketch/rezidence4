'use strict';

jest.mock('../db');
jest.mock('../sse', () => ({ broadcastUserDelete: jest.fn() }));
jest.mock('../middleware/auth', () => {
  const mw = (req, res, next) => {
    req.user = {
      uid: 'u1',
      phone: '+79001234567',
      role: 'owner',
      name: 'Resident',
    };
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
