'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const express = require('express');
const supertest = require('supertest');

jest.mock('../db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));
jest.mock('../logger', () => require('../__mocks__/logger'));

let mockCurrentUser = null;
jest.mock('../middleware/auth', () => (req, res, next) => {
  if (!mockCurrentUser) return res.status(401).json({ error: 'auth not set' });
  req.user = mockCurrentUser;
  next();
});

const db = require('../db');
const securityWorkspaceRouter = require('../v1/routes/securityWorkspace');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_OTHER_PROPERTY = '22222222-2222-4222-8222-222222222222';
const UUID_POINT = '33333333-3333-4333-8333-333333333333';
const UUID_ZONE = '44444444-4444-4444-8444-444444444444';
const UUID_STAFF = '55555555-5555-4555-8555-555555555555';
const UUID_VISIT_LOG = '66666666-6666-4666-8666-666666666666';
const UUID_INCIDENT = '77777777-7777-4777-8777-777777777777';
const UUID_OVERRIDE = '88888888-8888-4888-8888-888888888888';
const UUID_PASS = '99999999-9999-4999-8999-999999999999';
const UUID_REPLAY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_GUARD_DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/security-workspace', securityWorkspaceRouter);
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
  db.pool.connect.mockReset();
});

describe('security workspace routes', () => {
  test('GET /bootstrap returns station context and guard feeds', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points') && sql.includes('LIMIT 1') && !sql.includes('JOIN access_zones')) {
        return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      }
      if (sql.includes('JOIN access_zones')) {
        return Promise.resolve({
          rows: [{
            id: UUID_POINT,
            property_id: UUID_PROPERTY,
            zone_id: UUID_ZONE,
            name: 'КПП 1',
            point_type: 'barrier',
            provider: null,
            provider_external_id: null,
            zone_name: 'Периметр',
            zone_type: 'perimeter',
          }],
        });
      }
      if (sql.includes('FROM passes p')) {
        return Promise.resolve({ rows: [{ id: 'pass-1', status: 'active', point_id: UUID_POINT }] });
      }
      if (sql.includes('FROM access_requests ar')) {
        return Promise.resolve({
          rows: [{
            id: 'request-1',
            visitor_name: 'Guest',
            guest_instructions: 'Показать QR',
            guard_notes: 'Проверить документы',
          }],
        });
      }
      if (sql.includes('FROM visit_logs_v2 vl')) {
        return Promise.resolve({ rows: [{ id: 'visit-1', event_type: 'entry_allowed' }] });
      }
      if (sql.includes('FROM access_incidents ai')) {
        return Promise.resolve({ rows: [{ id: 'incident-1', incident_type: 'blacklist_hit' }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/security-workspace/bootstrap?property_id=${UUID_PROPERTY}&access_point_id=${UUID_POINT}&occurred_at=2026-05-05T09:00:00.000Z`);

    expect(res.status).toBe(200);
    expect(res.body.workspace.station_context.access_point.name).toBe('КПП 1');
    expect(res.body.workspace.active_passes).toHaveLength(1);
    expect(res.body.workspace.expected_guests).toHaveLength(1);
    expect(res.body.workspace.recent_events).toHaveLength(1);
    expect(res.body.workspace.blacklist_hits).toHaveLength(1);
    const expectedGuestsCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM access_requests ar'));
    expect(expectedGuestsCall[0]).toContain("ar.status = 'approved'");
    expect(expectedGuestsCall[0]).toContain('ar.guest_instructions');
    expect(expectedGuestsCall[0]).toContain('ar.guard_notes');
    expect(expectedGuestsCall[0]).not.toContain('pending_approval');
    expect(expectedGuestsCall[0]).not.toContain('escalated');
  });

  test('GET /search runs scoped vehicle-first search for security users', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM vehicles')) return Promise.resolve({ rows: [{ plate_number: 'A001AA77' }] });
      if (sql.includes('FROM residents')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM units')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM passes p')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .get(`/api/v1/security-workspace/search?property_id=${UUID_PROPERTY}&q=а001аа77`);

    expect(res.status).toBe(200);
    expect(res.body.results.normalized_plate).toBe('A001AA77');
    expect(res.body.results.vehicles[0].plate_number).toBe('A001AA77');
  });

  test('GET /recent-events filters by access point after topology validation', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query
      .mockResolvedValueOnce({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] })
      .mockResolvedValueOnce({ rows: [{ id: 'visit-1', access_point_id: UUID_POINT }] });

    const res = await supertest(buildApp())
      .get(`/api/v1/security-workspace/recent-events?property_id=${UUID_PROPERTY}&access_point_id=${UUID_POINT}&limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.visit_logs).toHaveLength(1);
    expect(db.query.mock.calls[1][0]).toContain('vl.access_point_id');
    expect(db.query.mock.calls[1][1]).toEqual([UUID_PROPERTY, UUID_POINT, 10, 0]);
  });

  test('rejects cross-property security tokens before querying workspace feeds', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_OTHER_PROPERTY };

    const res = await supertest(buildApp())
      .get(`/api/v1/security-workspace/bootstrap?property_id=${UUID_PROPERTY}`);

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('POST /manual-decision records point-scoped degraded decision transactionally', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    const txClient = {
      query: jest.fn((sql) => {
        if (['BEGIN', 'COMMIT'].includes(sql)) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        if (sql.includes('INSERT INTO visit_logs_v2')) {
          return Promise.resolve({
            rows: [{
              id: UUID_VISIT_LOG,
              property_id: UUID_PROPERTY,
              pass_id: UUID_PASS,
              access_point_id: UUID_POINT,
              event_type: 'manual_admit',
              event_source: 'guard_console',
              provider_payload: { degraded_mode: true },
            }],
          });
        }
        if (sql.includes('INSERT INTO access_incidents')) {
          return Promise.resolve({
            rows: [{
              id: UUID_INCIDENT,
              property_id: UUID_PROPERTY,
              related_visit_log_id: UUID_VISIT_LOG,
              incident_type: 'manual_override',
              severity: 'low',
              status: 'resolved',
            }],
          });
        }
        if (sql.includes('INSERT INTO access_overrides')) {
          return Promise.resolve({
            rows: [{
              id: UUID_OVERRIDE,
              property_id: UUID_PROPERTY,
              incident_id: UUID_INCIDENT,
              pass_id: UUID_PASS,
              performed_by_staff_id: UUID_STAFF,
              override_type: 'manual_admit',
              reason: 'resident confirmed at КПП',
            }],
          });
        }
        if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected tx SQL: ${sql}`);
      }),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/security-workspace/manual-decision')
      .send({
        property_id: UUID_PROPERTY,
        access_point_id: UUID_POINT,
        pass_id: UUID_PASS,
        decision: 'manual_admit',
        direction: 'entry',
        reason: 'resident confirmed at КПП',
        person_label: 'Ivan Petrov',
        vehicle_plate: 'a001aa77',
        degraded_mode: true,
        degraded_reason: 'cached_lookup',
        lookup_state: 'cached_hit',
        occurred_at: '2026-05-05T10:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.visit_log.id).toBe(UUID_VISIT_LOG);
    expect(res.body.incident.id).toBe(UUID_INCIDENT);
    expect(res.body.override.id).toBe(UUID_OVERRIDE);
    expect(db.query.mock.calls[0][0]).toContain('FROM access_points');
    expect(txClient.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitCall[1][0]).toBe(UUID_PROPERTY);
    expect(visitCall[1][2]).toBe(UUID_POINT);
    expect(visitCall[1][3]).toBe('manual_admit');
    expect(JSON.parse(visitCall[1][7])).toMatchObject({
      decision: 'manual_admit',
      degraded_mode: true,
      degraded_reason: 'cached_lookup',
      lookup_state: 'cached_hit',
    });
  });

  test('POST /manual-decision rejects missing reason before opening transaction', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockResolvedValueOnce({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });

    const res = await supertest(buildApp())
      .post('/api/v1/security-workspace/manual-decision')
      .send({
        property_id: UUID_PROPERTY,
        access_point_id: UUID_POINT,
        decision: 'manual_deny',
      });

    expect(res.status).toBe(422);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('POST /manual-decision requires active guard device when feature flag is enabled', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.property = { resolvedFlags: { guard_authorized_devices: true } };
      next();
    });
    app.use('/api/v1/security-workspace', securityWorkspaceRouter);
    app.use((err, _req, res, _next) => res.status(500).json({ error: String(err?.message || err) }));

    db.query.mockResolvedValueOnce({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });

    const res = await supertest(app)
      .post('/api/v1/security-workspace/manual-decision')
      .send({
        property_id: UUID_PROPERTY,
        access_point_id: UUID_POINT,
        decision: 'manual_deny',
        direction: 'entry',
        reason: 'missing authorized device',
        person_label: 'Unknown visitor',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('guard_device_id is required');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('POST /authorized-devices/enroll registers first-use guard console device', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT }] });
      if (sql.includes('INSERT INTO guard_authorized_devices')) {
        return Promise.resolve({
          rows: [{
            id: UUID_GUARD_DEVICE,
            property_id: UUID_PROPERTY,
            access_point_id: UUID_POINT,
            staff_user_id: UUID_STAFF,
            device_fingerprint: 'fingerprint-1234567890',
            label: 'КПП Север планшет',
            status: 'active',
          }],
        });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/security-workspace/authorized-devices/enroll')
      .send({
        property_id: UUID_PROPERTY,
        access_point_id: UUID_POINT,
        device_fingerprint: 'fingerprint-1234567890',
        label: 'КПП Север планшет',
      });

    expect(res.status).toBe(201);
    expect(res.body.guard_authorized_device.id).toBe(UUID_GUARD_DEVICE);
    const audit = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][4]).toBe('guard_authorized_device.enrolled');
  });

  test('POST /offline-replay links replay ledger to manual visit log', async () => {
    mockCurrentUser = { uid: 'security-1', role: 'security', property_id: UUID_PROPERTY };
    const txClient = {
      query: jest.fn((sql) => {
        if (['BEGIN', 'COMMIT'].includes(sql)) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
        if (sql.includes('INSERT INTO visit_logs_v2')) {
          return Promise.resolve({
            rows: [{
              id: UUID_VISIT_LOG,
              property_id: UUID_PROPERTY,
              access_point_id: UUID_POINT,
              event_type: 'manual_admit',
              event_source: 'guard_console',
              offline_replay_event_id: UUID_REPLAY,
            }],
          });
        }
        if (sql.includes('INSERT INTO access_incidents')) {
          return Promise.resolve({
            rows: [{
              id: UUID_INCIDENT,
              property_id: UUID_PROPERTY,
              related_visit_log_id: UUID_VISIT_LOG,
              incident_type: 'manual_override',
              severity: 'low',
              status: 'resolved',
            }],
          });
        }
        if (sql.includes('INSERT INTO access_overrides')) {
          return Promise.resolve({
            rows: [{
              id: UUID_OVERRIDE,
              property_id: UUID_PROPERTY,
              incident_id: UUID_INCIDENT,
              performed_by_staff_id: UUID_STAFF,
              override_type: 'manual_admit',
              reason: 'offline queue sync',
            }],
          });
        }
        if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
        throw new Error(`unexpected tx SQL: ${sql}`);
      }),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(txClient);
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT, zone_id: UUID_ZONE }] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM security_offline_replay_events')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO security_offline_replay_events')) {
        return Promise.resolve({
          rows: [{
            id: UUID_REPLAY,
            property_id: UUID_PROPERTY,
            client_event_id: 'queue-1',
            event_type: 'manual_admit',
            replay_status: 'accepted',
            occurred_at: '2026-05-05T10:00:00.000Z',
            payload: {},
            processed_at: '2026-05-05T10:01:00.000Z',
            created_at: '2026-05-05T10:01:00.000Z',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const res = await supertest(buildApp())
      .post('/api/v1/security-workspace/offline-replay')
      .send({
        property_id: UUID_PROPERTY,
        events: [{
          client_event_id: 'queue-1',
          event_type: 'manual_admit',
          access_point_id: UUID_POINT,
          direction: 'entry',
          person_label: 'Offline guest',
          vehicle_plate: 'a001aa77',
          reason: 'offline queue sync',
          occurred_at: '2026-05-05T10:00:00.000Z',
        }],
      });

    expect(res.status).toBe(202);
    expect(res.body.results[0].replay_event.id).toBe(UUID_REPLAY);
    expect(res.body.results[0].result.visit_log.offline_replay_event_id).toBe(UUID_REPLAY);

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitCall[0]).toContain('offline_replay_event_id');
    expect(visitCall[1][8]).toBe(UUID_REPLAY);
  });
});
