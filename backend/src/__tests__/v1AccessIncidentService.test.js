'use strict';

const {
  assignIncident,
  createIncident,
  createManualSecurityDecision,
  createOverride,
  dismissIncident,
  resolveIncident,
} = require('../v1/services/accessIncidentService');

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_INCIDENT = '22222222-2222-4222-8222-222222222222';
const UUID_STAFF = '44444444-4444-4444-8444-444444444444';
const UUID_VISIT_LOG = '55555555-5555-4555-8555-555555555555';
const UUID_OVERRIDE = '66666666-6666-4666-8666-666666666666';
const UUID_POINT = '77777777-7777-4777-8777-777777777777';
const UUID_PASS = '88888888-8888-4888-8888-888888888888';

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
      if (sql.includes('FROM access_incidents') && sql.includes('status')) {
        return Promise.resolve({ rows: [{ property_id: UUID_PROPERTY, status: 'resolved', assigned_to_staff_id: null }] });
      }
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
      if (sql.includes('FROM access_incidents')) return Promise.resolve({ rows: [{ id: UUID_INCIDENT }] });
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

  test('createIncident rejects related pass from another property', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM passes')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(createIncident({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        related_pass_id: UUID_PASS,
        related_visit_log_id: null,
        related_vehicle_id: null,
        incident_type: 'invalid_qr',
        severity: 'medium',
        title: 'Invalid QR',
        description: null,
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'related_pass_id does not exist for this property',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_incidents'))).toBe(false);
  });

  test('assignIncident rejects assignee from another property', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM access_incidents') && sql.includes('status')) {
        return Promise.resolve({ rows: [{ property_id: UUID_PROPERTY, status: 'open' }] });
      }
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(assignIncident({
      queryable,
      incidentId: UUID_INCIDENT,
      assignee: UUID_STAFF,
      propertyId: UUID_PROPERTY,
    })).rejects.toMatchObject({
      status: 400,
      message: 'assigned_to_staff_id does not exist for this property',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('UPDATE access_incidents'))).toBe(false);
  });

  test('createOverride rejects incident_id from another property', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_incidents')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(createOverride({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        incident_id: UUID_INCIDENT,
        pass_id: null,
        override_type: 'manual_admit',
        reason: 'resident confirmed',
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'incident_id does not exist for this property',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_overrides'))).toBe(false);
  });

  test('createOverride rejects pass_id from another property', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM passes')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(createOverride({
      queryable,
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        incident_id: null,
        pass_id: UUID_PASS,
        override_type: 'manual_admit',
        reason: 'resident confirmed',
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'pass_id does not exist for this property',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_overrides'))).toBe(false);
  });

  test('resolveIncident rejects override pass_id from another property', async () => {
    const txClient = makeTxClient((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM access_incidents') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            property_id: UUID_PROPERTY,
            status: 'investigating',
            related_pass_id: null,
            assigned_to_staff_id: null,
          }],
        });
      }
      if (sql.includes('FROM passes')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(resolveIncident({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-security-1', role: 'security' },
      incidentId: UUID_INCIDENT,
      reason: 'done',
      overrideInput: {
        pass_id: UUID_PASS,
        override_type: 'manual_admit',
        reason: 'resident confirmed',
      },
      isPropertyAdmin: true,
      propertyId: UUID_PROPERTY,
    })).rejects.toMatchObject({
      status: 400,
      message: 'pass_id does not exist for this property',
    });

    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('UPDATE access_incidents'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO access_overrides'))).toBe(false);
    expect(txClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(txClient.release).toHaveBeenCalledTimes(1);
  });

  test('createManualSecurityDecision writes visit log, incident, override and audit in one transaction', async () => {
    const txClient = makeTxClient((sql) => {
      if (['BEGIN', 'COMMIT'].includes(sql)) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: UUID_STAFF }] });
      if (sql.includes('FROM passes')) return Promise.resolve({ rows: [{ id: UUID_PASS }] });
      if (sql.includes('FROM access_points')) return Promise.resolve({ rows: [{ id: UUID_POINT }] });
      if (sql.includes('INSERT INTO visit_logs_v2')) {
        return Promise.resolve({
          rows: [{
            id: UUID_VISIT_LOG,
            property_id: UUID_PROPERTY,
            pass_id: UUID_PASS,
            access_point_id: UUID_POINT,
            event_type: 'manual_deny',
            event_source: 'guard_console',
            vehicle_plate: 'A001AA77',
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
            severity: 'medium',
            status: 'resolved',
            created_by_staff_id: UUID_STAFF,
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
            override_type: 'manual_deny',
            reason: 'offline deny',
          }],
        });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await createManualSecurityDecision({
      txPool: makeTxPool(txClient),
      user: { uid: 'legacy-security-1', role: 'security' },
      input: {
        property_id: UUID_PROPERTY,
        access_point_id: UUID_POINT,
        pass_id: UUID_PASS,
        decision: 'manual_deny',
        direction: 'exit',
        reason: 'offline deny',
        person_label: 'Visitor',
        vehicle_plate: 'a001aa77',
        degraded_mode: true,
        degraded_reason: 'no_lookup',
        lookup_state: 'unavailable',
        occurred_at: '2026-05-05T10:00:00.000Z',
      },
    });

    expect(result.visit_log.id).toBe(UUID_VISIT_LOG);
    expect(result.incident.id).toBe(UUID_INCIDENT);
    expect(result.override.id).toBe(UUID_OVERRIDE);
    expect(txClient.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));

    const visitCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO visit_logs_v2'));
    expect(visitCall[1]).toEqual([
      UUID_PROPERTY,
      UUID_PASS,
      UUID_POINT,
      'manual_deny',
      'Visitor',
      'A001AA77',
      UUID_STAFF,
      expect.any(String),
      null,
      true,
      'pending',
      '2026-05-05T10:00:00.000Z',
    ]);
    expect(JSON.parse(visitCall[1][7])).toMatchObject({
      decision: 'manual_deny',
      direction: 'exit',
      degraded_mode: true,
      degraded_reason: 'no_lookup',
      reconciliation_state: 'pending',
    });

    const incidentCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_incidents'));
    expect(incidentCall[1]).toEqual([
      UUID_PROPERTY,
      UUID_PASS,
      UUID_VISIT_LOG,
      null,
      'medium',
      'investigating',
      'Manual deny at access point',
      expect.stringContaining('offline deny'),
      UUID_STAFF,
      null,
    ]);

    const overrideCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO access_overrides'));
    expect(overrideCall[1]).toEqual([
      UUID_PROPERTY,
      UUID_INCIDENT,
      UUID_PASS,
      UUID_STAFF,
      'manual_deny',
      'offline deny',
    ]);

    const auditCall = txClient.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(auditCall[1][0]).toBe(UUID_PROPERTY);
    expect(auditCall[1][1]).toBe('legacy-security-1');
    expect(auditCall[1][2]).toBe('security');
    expect(auditCall[1][3]).toBe(UUID_STAFF);
    expect(auditCall[1][4]).toBe(UUID_OVERRIDE);
  });
});
