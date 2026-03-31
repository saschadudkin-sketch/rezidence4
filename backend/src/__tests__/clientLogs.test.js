'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../logger', () => ({
  warn: jest.fn(),
}));

const logger = require('../logger');
const clientLogsRouter = require('../routes/clientLogs');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/client-logs', clientLogsRouter);
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

  test('redacts sensitive keys in context before logging', async () => {
    const app = createApp();
    const payload = {
      errors: [{
        message: 'boom',
        context: {
          token: 'abc',
          nested: { password: 'secret' },
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
    expect(logged.context.safe).toBe('ok');
  });
});

