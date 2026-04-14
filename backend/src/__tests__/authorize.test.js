'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../logger', () => ({
  warn: jest.fn(),
}));

const logger = require('../logger');
const { authorize } = require('../middleware/authorize');

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/admin-only', authorize('admin'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('authorize middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('allows request when role is permitted', async () => {
    const res = await request(buildApp({ uid: 'a1', role: 'admin' })).get('/admin-only');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('returns 403 with structured error when role is denied', async () => {
    const res = await request(buildApp({ uid: 'u1', role: 'owner' })).get('/admin-only');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Недостаточно прав', required: ['admin'] });
    expect(logger.warn).toHaveBeenCalled();
  });
});
