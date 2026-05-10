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

jest.mock('../v1/services/analyticsAggregationService', () => ({
  getLatestPropertyAnalyticsSnapshot: jest.fn(),
  listPropertyAnalyticsSnapshots: jest.fn(),
  materializePropertyAnalyticsSnapshot: jest.fn(),
  renderMetricsCsv: jest.fn(),
}));

const db = require('../db');
const service = require('../v1/services/analyticsAggregationService');
const router = require('../v1/routes/analyticsAggregation');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/analytics', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
});

describe('v1 analytics aggregation route', () => {
  test('property admin can materialize a snapshot manually', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.materializePropertyAnalyticsSnapshot.mockResolvedValue({
      snapshot: { id: 'snapshot-1', period: '7d' },
      metrics: [{ metric_key: 'requests.created', value: 12 }],
    });

    const res = await supertest(buildApp())
      .post('/api/v1/analytics/snapshots')
      .send({ property_id: PROPERTY_ID, period: '7d' });

    expect(res.status).toBe(201);
    expect(res.body.snapshot.id).toBe('snapshot-1');
    expect(service.materializePropertyAnalyticsSnapshot).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      period: '7d',
      generatedBy: 'manual',
    });
  });

  test('resident cannot read analytics snapshots', async () => {
    mockCurrentUser = { uid: 'resident-1', role: 'resident', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .get(`/api/v1/analytics/snapshots?property_id=${PROPERTY_ID}`);

    expect(res.status).toBe(403);
    expect(service.listPropertyAnalyticsSnapshots).not.toHaveBeenCalled();
  });

  test('latest snapshot can be exported as CSV', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'property_admin', property_id: PROPERTY_ID };
    service.getLatestPropertyAnalyticsSnapshot.mockResolvedValue({
      id: 'snapshot-1',
      period: '24h',
      flat_rows: [{ metric_key: 'requests.created', value: 3 }],
    });
    service.renderMetricsCsv.mockReturnValue('metric_key,value\nrequests.created,3\n');

    const res = await supertest(buildApp())
      .get(`/api/v1/analytics/snapshots/latest?property_id=${PROPERTY_ID}&period=24h&format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('analytics-24h.csv');
    expect(res.text).toContain('requests.created,3');
    expect(service.getLatestPropertyAnalyticsSnapshot).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      period: '24h',
    });
  });
});
