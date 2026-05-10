'use strict';

const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

jest.mock('../v1/services/skudIntegrationService', () => ({
  ingestProviderAccessEvent: jest.fn(),
  syncPassAccess: jest.fn(),
  isSkudIntegrationServiceError: (err) => err?.name === 'SkudIntegrationServiceError',
}));

const db = require('../db');
const {
  ingestProviderAccessEvent,
  syncPassAccess,
} = require('../v1/services/skudIntegrationService');
const skudRouter = require('../v1/routes/skudIntegrations');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PASS_ID = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.property = { id: PROPERTY_ID };
    next();
  });
  app.use('/api/v1/skud', skudRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: String(err && err.message || err) });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  db.query.mockResolvedValue({ rows: [] });
});

describe('v1 SKUD integration routes', () => {
  test('POST /providers/:id/events accepts external event without user session', async () => {
    ingestProviderAccessEvent.mockResolvedValue({
      idempotent: false,
      normalized_event: { eventType: 'entry_allowed' },
      integration_event: { id: 'event-1' },
      visit_log: { id: 'visit-1' },
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/skud/providers/${PROVIDER_ID}/events`)
      .set('X-SKUD-Secret', 'secret-1')
      .send({ eventId: 'provider-event-1' });

    expect(res.status).toBe(201);
    expect(res.body.visit_log.id).toBe('visit-1');
    expect(ingestProviderAccessEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      providedSecret: 'secret-1',
      requireSecret: true,
      rawEvent: { eventId: 'provider-event-1' },
    }));
  });

  test('POST /providers/:id/sync-pass requires scoped admin and syncs pass', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: PROPERTY_ID };
    syncPassAccess.mockResolvedValue({
      pass: { id: PASS_ID },
      provider_config: { id: PROVIDER_ID },
      integration_event: { id: 'event-2', status: 'succeeded' },
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/skud/providers/${PROVIDER_ID}/sync-pass`)
      .send({ pass_id: PASS_ID, action: 'provision' });

    expect(res.status).toBe(202);
    expect(res.body.integration_event.status).toBe('succeeded');
    expect(syncPassAccess).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      passId: PASS_ID,
      action: 'provision',
    }));
  });

  test('POST /providers/:id/sync-pass denies cross-property admin', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: '99999999-9999-4999-8999-999999999999' };

    const res = await supertest(buildApp())
      .post(`/api/v1/skud/providers/${PROVIDER_ID}/sync-pass`)
      .send({ pass_id: PASS_ID, action: 'provision' });

    expect(res.status).toBe(403);
    expect(syncPassAccess).not.toHaveBeenCalled();
  });
});
