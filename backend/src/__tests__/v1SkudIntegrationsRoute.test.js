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
  getProviderFailureDashboard: jest.fn(),
  ingestProviderAccessEvent: jest.fn(),
  listHardwareDevices: jest.fn(),
  listHardwareManualControlEvents: jest.fn(),
  recordFieldRolloutEvidence: jest.fn(),
  recordHardwareManualControl: jest.fn(),
  syncPassAccess: jest.fn(),
  updateHardwareManualBoundary: jest.fn(),
  isSkudIntegrationServiceError: (err) => err?.name === 'SkudIntegrationServiceError',
}));

const db = require('../db');
const {
  getProviderFailureDashboard,
  ingestProviderAccessEvent,
  listHardwareDevices,
  listHardwareManualControlEvents,
  recordFieldRolloutEvidence,
  recordHardwareManualControl,
  syncPassAccess,
  updateHardwareManualBoundary,
} = require('../v1/services/skudIntegrationService');
const skudRouter = require('../v1/routes/skudIntegrations');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PASS_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';

function buildApp({ property = { id: PROPERTY_ID } } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (property) req.property = property;
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

  test('GET /hardware-devices lists scoped devices for security', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security', property_id: PROPERTY_ID };
    listHardwareDevices.mockResolvedValue([{ id: DEVICE_ID, manual_control_policy: 'guard_allowed' }]);

    const res = await supertest(buildApp())
      .get(`/api/v1/skud/hardware-devices?provider_config_id=${PROVIDER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.hardware_devices).toHaveLength(1);
    expect(listHardwareDevices).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      accessPointId: null,
    });
  });

  test('GET /provider-failures returns scoped failure dashboard for security', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security', property_id: PROPERTY_ID };
    getProviderFailureDashboard.mockResolvedValue({
      property_id: PROPERTY_ID,
      window_hours: 24,
      summary: { providers_needing_attention: 1 },
      providers: [],
      field_rollout_evidence: { real_failure_rows: 2 },
    });

    const res = await supertest(buildApp())
      .get('/api/v1/skud/provider-failures?window_hours=24&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.dashboard.summary.providers_needing_attention).toBe(1);
    expect(getProviderFailureDashboard).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      windowHours: '24',
      limit: '10',
    });
  });

  test('POST /field-rollout-evidence records scoped field evidence for admins', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: PROPERTY_ID };
    recordFieldRolloutEvidence.mockResolvedValue({
      id: 'rollout-1',
      property_id: PROPERTY_ID,
      evidence_type: 'field_drill',
      status: 'passed',
    });

    const res = await supertest(buildApp())
      .post('/api/v1/skud/field-rollout-evidence')
      .send({
        provider_config_id: PROVIDER_ID,
        evidence_type: 'field_drill',
        status: 'passed',
      });

    expect(res.status).toBe(201);
    expect(res.body.evidence).toMatchObject({ evidence_type: 'field_drill', status: 'passed' });
    expect(recordFieldRolloutEvidence).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      provider_config_id: PROVIDER_ID,
      evidence_type: 'field_drill',
      actorUid: 'admin-1',
    }));
  });

  test('POST /field-rollout-evidence resolves camelCase propertyId from body', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: null };
    recordFieldRolloutEvidence.mockResolvedValue({
      id: 'rollout-1',
      property_id: PROPERTY_ID,
      evidence_type: 'field_drill',
      status: 'passed',
    });

    const res = await supertest(buildApp({ property: null }))
      .post('/api/v1/skud/field-rollout-evidence')
      .send({
        propertyId: PROPERTY_ID,
        evidenceType: 'field_drill',
        status: 'passed',
      });

    expect(res.status).toBe(201);
    expect(recordFieldRolloutEvidence).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      evidenceType: 'field_drill',
      actorUid: 'admin-1',
    }));
  });

  test('PATCH /hardware-devices/:id/boundary requires admin and updates boundary policy', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: PROPERTY_ID };
    updateHardwareManualBoundary.mockResolvedValue({
      hardware_device: { id: DEVICE_ID, manual_control_policy: 'admin_only' },
    });

    const res = await supertest(buildApp())
      .patch(`/api/v1/skud/hardware-devices/${DEVICE_ID}/boundary`)
      .send({ manual_control_policy: 'admin_only' });

    expect(res.status).toBe(200);
    expect(res.body.hardware_device.manual_control_policy).toBe('admin_only');
    expect(updateHardwareManualBoundary).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      manual_control_policy: 'admin_only',
      actorUid: 'admin-1',
      actorRole: 'admin',
    }));
  });

  test('PATCH /hardware-devices/:id/boundary denies security', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security', property_id: PROPERTY_ID };

    const res = await supertest(buildApp())
      .patch(`/api/v1/skud/hardware-devices/${DEVICE_ID}/boundary`)
      .send({ manual_control_policy: 'admin_only' });

    expect(res.status).toBe(403);
    expect(updateHardwareManualBoundary).not.toHaveBeenCalled();
  });

  test('POST /hardware-devices/:id/manual-control allows guard action', async () => {
    mockCurrentUser = { uid: 'guard-1', role: 'security', property_id: PROPERTY_ID };
    recordHardwareManualControl.mockResolvedValue({
      hardware_device: { id: DEVICE_ID },
      manual_control_event: { id: 'event-1', action: 'manual_open' },
    });

    const res = await supertest(buildApp())
      .post(`/api/v1/skud/hardware-devices/${DEVICE_ID}/manual-control`)
      .send({ action: 'manual_open', reason: 'verified manually' });

    expect(res.status).toBe(201);
    expect(res.body.manual_control_event.action).toBe('manual_open');
    expect(recordHardwareManualControl).toHaveBeenCalledWith(db, expect.objectContaining({
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      action: 'manual_open',
      reason: 'verified manually',
      actorUid: 'guard-1',
      actorRole: 'security',
    }));
  });

  test('GET /hardware-devices/:id/manual-control-events returns event evidence', async () => {
    mockCurrentUser = { uid: 'admin-1', role: 'admin', property_id: PROPERTY_ID };
    listHardwareManualControlEvents.mockResolvedValue([{ id: 'event-1' }]);

    const res = await supertest(buildApp())
      .get(`/api/v1/skud/hardware-devices/${DEVICE_ID}/manual-control-events?limit=20`);

    expect(res.status).toBe(200);
    expect(res.body.manual_control_events).toEqual([{ id: 'event-1' }]);
    expect(listHardwareManualControlEvents).toHaveBeenCalledWith(db, {
      propertyId: PROPERTY_ID,
      hardwareDeviceId: DEVICE_ID,
      limit: '20',
    });
  });
});
