'use strict';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../db');
const db = require('../db');

function buildAppWithFreshAuthRouter() {
  let authRouter;
  jest.isolateModules(() => {
    authRouter = require('../routes/auth');
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

describe('REFRESH_LEGACY_FALLBACK_ENABLED config', () => {
  const originalEnv = process.env.REFRESH_LEGACY_FALLBACK_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
  });

  afterAll(() => {
    process.env.REFRESH_LEGACY_FALLBACK_ENABLED = originalEnv;
  });

  test('fallback OFF (0): does not query legacy refresh id path', async () => {
    process.env.REFRESH_LEGACY_FALLBACK_ENABLED = '0';
    const app = buildAppWithFreshAuthRouter();

    db.query.mockResolvedValueOnce({ rows: [] }); // hash path miss

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=legacy-raw-token']);

    expect(res.status).toBe(401);

    const legacyDeleteCall = db.query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM refresh_tokens WHERE id=$1'),
    );
    expect(legacyDeleteCall).toBeUndefined();
  });
});
