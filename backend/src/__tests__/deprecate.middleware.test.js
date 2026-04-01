'use strict';

const express = require('express');
const request = require('supertest');
const {
  deprecate,
  SUNSET_ISO_DATE,
  SUNSET_HTTP_DATE,
  DEPRECATION_HEADER_VALUE,
} = require('../middleware/deprecate');

describe('deprecate middleware', () => {
  test('sets Deprecation and Sunset headers on legacy /api/* route with synchronized date', async () => {
    const app = express();

    app.get('/api/legacy-ping', deprecate, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app).get('/api/legacy-ping').expect(200);

    expect(res.headers.deprecation).toBe(DEPRECATION_HEADER_VALUE);
    expect(res.headers.sunset).toBe(SUNSET_HTTP_DATE);

    const deprecationMatch = /version="(\d{4}-\d{2}-\d{2})"/.exec(res.headers.deprecation);
    expect(deprecationMatch).not.toBeNull();
    expect(deprecationMatch[1]).toBe(SUNSET_ISO_DATE);

    const parsedSunsetMs = Date.parse(res.headers.sunset);
    expect(Number.isNaN(parsedSunsetMs)).toBe(false);

    const parsedSunsetIsoDate = new Date(parsedSunsetMs).toISOString().slice(0, 10);
    expect(parsedSunsetIsoDate).toBe(deprecationMatch[1]);
  });
});
