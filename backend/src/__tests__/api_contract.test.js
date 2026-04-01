'use strict';

const path = require('path');
const fs = require('fs');
const request = require('supertest');

jest.mock('../db');
const db = require('../db');

const express = require('express');
const cookieParser = require('cookie-parser');
const authRouter = require('../routes/auth');

jest.mock('../middleware/auth', () => {
  const fn = (req, _res, next) => {
    req.user = { uid: 'u1', role: 'owner', name: 'User' };
    next();
  };
  fn.markTokenRevoked = jest.fn().mockResolvedValue(undefined);
  return fn;
});
const chatRouter = require('../routes/chat');
const usersRouter = require('../routes/users');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/chat', chatRouter);
  app.use('/api/v1/users', usersRouter);
  return app;
}

const OPENAPI_FILE = path.resolve(__dirname, '../../../docs/openapi.json');

function readOpenApiSpec() {
  return JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
}

function assertOperationResponseSchemas(operation) {
  expect(operation.responses).toBeDefined();

  for (const [statusCode, response] of Object.entries(operation.responses)) {
    // 204 No Content valid без content.
    if (statusCode === '204') continue;

    if (!response.content) {
      continue;
    }

    for (const [mediaType, mediaTypeSchema] of Object.entries(response.content ?? {})) {
      // Строго проверяем JSON-контракты. Для non-JSON ответов
      // (text/event-stream, text/plain, binary) schema может быть
      // не обязателен в наших smoke-правилах.
      if (mediaType !== 'application/json') continue;
      expect(mediaTypeSchema.schema).toBeDefined();
    }
  }
}

function normalizePath(pathname) {
  return pathname.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectRouterRoutes(router, mountPath) {
  const routes = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const rawPath = layer.route.path === '/' ? '' : String(layer.route.path);
    const normalized = normalizePath(`${mountPath}${rawPath}`);
    for (const [method, enabled] of Object.entries(layer.route.methods || {})) {
      if (!enabled) continue;
      routes.push({ method, path: normalized });
    }
  }
  return routes;
}

describe('OpenAPI contract smoke', () => {
  test('docs/openapi.json contains core contract paths', () => {
    const spec = readOpenApiSpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/v1/auth/send-otp']).toBeDefined();
    expect(spec.paths['/api/v1/auth/refresh']).toBeDefined();
    expect(spec.paths['/api/v1/auth/me']).toBeDefined();
    expect(spec.paths['/api/v1/requests']).toBeDefined();
    expect(spec.paths['/api/v1/users']).toBeDefined();
    expect(spec.paths['/api/v1/users/deleted']).toBeDefined();
    expect(spec.paths['/api/v1/users/{uid}/restore']).toBeDefined();
    expect(spec.paths['/api/v1/upload/photo']).toBeDefined();
    expect(spec.paths['/api/v1/chat/messages']).toBeDefined();
    expect(spec.paths['/api/v1/chat/stream']).toBeDefined();
  });

  test('runtime routes (auth/chat/users) are documented in OpenAPI', () => {
    const spec = readOpenApiSpec();
    const documented = spec.paths || {};
    const routes = [
      ...collectRouterRoutes(authRouter, '/api/v1/auth'),
      ...collectRouterRoutes(chatRouter, '/api/v1/chat'),
      ...collectRouterRoutes(usersRouter, '/api/v1/users'),
    ];

    for (const r of routes) {
      const op = documented[r.path]?.[r.method];
      expect(op).toBeDefined();
    }
  });

  test('all declared operations have response schema', () => {
    const spec = readOpenApiSpec();
    for (const [, methods] of Object.entries(spec.paths)) {
      for (const [, operation] of Object.entries(methods)) {
        assertOperationResponseSchemas(operation);
      }
    }
  });

  test('allows 204 response without content (positive)', () => {
    expect(() => {
      assertOperationResponseSchemas({
        responses: {
          204: { description: 'No Content' },
        },
      });
    }).not.toThrow();
  });

  test('fails when application/json has no schema (negative)', () => {
    expect(() => {
      assertOperationResponseSchemas({
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {},
            },
          },
        },
      });
    }).toThrow();
  });

  test('allows non-json response content without schema (positive)', () => {
    expect(() => {
      assertOperationResponseSchemas({
        responses: {
          200: {
            description: 'OK',
            content: {
              'text/plain': {},
            },
          },
        },
      });
    }).not.toThrow();
  });
});

describe('runtime responses match documented contract (core fields)', () => {
  const app = buildApp();

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/v1/auth/send-otp success returns {ok:boolean}', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '+79001234567' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('POST /api/v1/auth/send-otp validation error returns {error:string}', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .send({ phone: '123' });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('GET /api/v1/chat/messages returns {messages, hasMore}', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      id: 'm1', uid: 'u1', name: 'User', role: 'owner', text: 'hi', photo: null, reply_to: null, reactions: {}, edited: false, at: new Date().toISOString(),
    }] });

    const res = await request(app)
      .get('/api/v1/chat/messages')
      .set('Cookie', ['token=dummy']);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(typeof res.body.hasMore).toBe('boolean');
  });
});
