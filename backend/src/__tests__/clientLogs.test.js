'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../logger', () => ({
  warn: jest.fn(),
}));

const logger = require('../logger');
const clientLogsRouter = require('../routes/clientLogs');
const {
  DEPRECATION_HEADER_VALUE,
  SUNSET_HTTP_DATE,
  deprecate,
} = require('../middleware/deprecate');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/client-logs', deprecate, clientLogsRouter);
  return app;
}

describe('clientLogs route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 when errors array is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/client-logs').send({});
    expect(res.status).toBe(400);
  });

  test('legacy alias emits deprecation headers', async () => {
    const app = createApp();
    const res = await request(app).post('/api/client-logs').send({
      errors: [{ message: 'legacy client log' }],
    });

    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe(DEPRECATION_HEADER_VALUE);
    expect(res.headers.sunset).toBe(SUNSET_HTTP_DATE);
  });

  test('redacts sensitive keys in context before logging', async () => {
    const app = createApp();
    const payload = {
      errors: [{
        message: 'boom',
        context: {
          token: 'abc',
          nested: { password: 'secret' },
          email: 'u@example.com',
          apiKey: 'key-123',
          authorization: 'Bearer token',
          safe: 'ok',
        },
      }],
    };

    const res = await request(app).post('/api/client-logs').send(payload);
    expect(res.status).toBe(200);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = logger.warn.mock.calls[0][0].clientError;
    expect(logged.context.token).toBe('[redacted]');
    expect(logged.context.nested.password).toBe('[redacted]');
    expect(logged.context.email).toBe('[redacted]');
    expect(logged.context.apiKey).toBe('[redacted]');
    expect(logged.context.authorization).toBe('[redacted]');
    expect(logged.context.safe).toBe('ok');
  });
});
