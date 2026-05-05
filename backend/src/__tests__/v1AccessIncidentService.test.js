'use strict';

const {
  createIncident,
  createOverride,
  dismissIncident,
  resolveIncident,
} = require('../v1/services/accessIncidentService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_INCIDENT = '22222222-2222-4222-8222-222222222222';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

function makeTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

function makeTxPool(client) {
  return { connect: jest.fn().mockResolvedValue(client) };
}

describe('AccessIncidentService', () => {
  test('createIncident writes staff_users.id as created_by_staff_id', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO access_incidents')) {
        return Promise.resolve({ rows: [{ id: UUID_INCIDENT, property_id: UUID_PROPERTY, created_by_staff_id: UUID_STAFF }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createIncident({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        related_pass_id: null,
        related_visit_log_id: null,
        related_vehicle_id: null,
        incident_type: 'invalid_qr',
        severity: 'medium',
        title: 'Invalid QR',
        description: null,
      },
    });

    expect(result.incident.created_by_staff_id).toBe(UUID_STAFF);
    const insertCall = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(insertCall[1]).toContain(UUID_STAFF);
    expect(insertCall[1]).not.toContain('legacy-security-1');
  });

  test('resolveIncident rejects incidents assigned to another staff', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_incidents') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            property_id: UUID_PROPERTY,
            status: 'investigating',
            related_pass_id: null,
            assigned_to_staff_id: '55555555-5555-4555-8555-555555555555',
          }],
        });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(resolveIncident({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-security-1', role: 'security' },
      incidentId: UUID_INCIDENT,
      reason: 'done',
      overrideInput: null,
      isPropertyAdmin: false,
    })).rejects.toMatchObject({
      status: 403,
      message: 'Incident is assigned to another staff',
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('UPDATE access_incidents'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('dismissIncident rejects terminal incident statuses', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('SELECT status')) return Promise.resolve({ rows: [{ status: 'resolved', assigned_to_staff_id: null }] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(dismissIncident({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      incidentId: UUID_INCIDENT,
      reason: 'duplicate',
      isPropertyAdmin: false,
    })).rejects.toMatchObject({
      status: 409,
      message: 'Incident already resolved',
    });
  });

  test('createOverride writes performed_by_staff_id from staff mapping', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('INSERT INTO access_overrides')) {
        return Promise.resolve({ rows: [{ id: 'override-1', property_id: UUID_PROPERTY, performed_by_staff_id: UUID_STAFF }] });
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createOverride({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        incident_id: UUID_INCIDENT,
        pass_id: null,
        override_type: 'manual_admit',
        reason: 'resident confirmed',
      },
    });

    expect(result.override.performed_by_staff_id).toBe(UUID_STAFF);
    const insertCall = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_overrides'));
    expect(insertCall[1]).toContain(UUID_STAFF);
    expect(insertCall[1]).not.toContain('legacy-security-1');
  });
});
