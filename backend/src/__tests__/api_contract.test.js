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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/chat', chatRouter);
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

describe('OpenAPI contract smoke', () => {
  test('docs/openapi.json contains core contract paths', () => {
    const spec = readOpenApiSpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/v1/auth/send-otp']).toBeDefined();
    expect(spec.paths['/api/v1/auth/refresh']).toBeDefined();
    expect(spec.paths['/api/v1/requests']).toBeDefined();
    expect(spec.paths['/api/v1/users']).toBeDefined();
    expect(spec.paths['/api/v1/upload/photo']).toBeDefined();
    expect(spec.paths['/api/v1/chat/messages']).toBeDefined();
  });

  test('all declared operations have response schema', () => {
    const spec = readOpenApiSpec();
    // OpenAPI 3.0 Path Item Object разрешает на уровне пути не-метод поля
    // (parameters, summary, description, servers).  Фильтруем итерацию строго
    // на HTTP методы, иначе assertOperationResponseSchemas падает на массиве
    // parameters, у которого нет .responses.
    const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    for (const [, methods] of Object.entries(spec.paths)) {
      for (const [methodName, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(methodName.toLowerCase())) continue;
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
