'use strict';

const {
  buildEmergencyProfileInput,
  createEmergencyProfileForRequest,
  listEmergencyQueue,
  recordEmergencyDispatchAction,
} = require('../services/requests/EmergencyDispatchService');

describe('EmergencyDispatchService', () => {
  const request = {
    id: 'req-emergency',
    category: 'emergency_fire_smoke',
    created_by_uid: 'resident-1',
    created_by_role: 'owner',
    first_response_due_at: new Date('2026-05-08T08:05:00Z'),
    resolution_due_at: new Date('2026-05-08T09:00:00Z'),
  };
  const categoryProfile = {
    code: 'emergency_fire_smoke',
    name: 'Пожар / дым',
    isEmergency: true,
    firstResponseMinutes: 5,
    resolutionMinutes: 60,
    metadata: {},
  };

  test('builds default P0 security profile for fire/smoke emergency', () => {
    expect(buildEmergencyProfileInput({ request, categoryProfile })).toMatchObject({
      requestId: 'req-emergency',
      emergencyType: 'fire_smoke',
      severity: 'P0',
      escalationTarget: 'security',
    });
  });

  test('createEmergencyProfileForRequest inserts operational profile', async () => {
    const queryDb = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 'profile-1',
          request_id: 'req-emergency',
          emergency_type: 'fire_smoke',
          severity: 'P0',
          dispatch_status: 'new',
          escalation_target: 'security',
          first_response_due_at: request.first_response_due_at,
          resolution_due_at: request.resolution_due_at,
          notification_status: 'pending',
          metadata: { category: 'emergency_fire_smoke' },
        }],
      }),
    };

    const profile = await createEmergencyProfileForRequest(queryDb, {
      request,
      categoryProfile,
      propertyId: 'property-1',
    });

    expect(profile).toMatchObject({
      requestId: 'req-emergency',
      emergencyType: 'fire_smoke',
      severity: 'P0',
      notificationStatus: 'pending',
    });
    expect(queryDb.query.mock.calls[0][0]).toMatch(/INSERT INTO emergency_request_profiles/);
    expect(queryDb.query.mock.calls[0][1][0]).toBe('property-1');
  });

  test('listEmergencyQueue rejects residents and orders by emergency severity', async () => {
    await expect(listEmergencyQueue(
      { uid: 'resident-1', role: 'owner' },
      { query: jest.fn() },
    )).rejects.toMatchObject({ status: 403 });

    const queryDb = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await listEmergencyQueue({ uid: 'guard-1', role: 'security' }, queryDb, { limit: 20 });
    expect(queryDb.query.mock.calls[0][0]).toMatch(/ORDER BY CASE p\.severity/);
  });

  test('recordEmergencyDispatchAction escalates request SLA state', async () => {
    const queryDb = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'profile-1',
            request_id: 'req-emergency',
            emergency_type: 'security',
            severity: 'P0',
            dispatch_status: 'escalated',
            escalation_target: 'security',
            notification_status: 'pending',
            metadata: {},
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const profile = await recordEmergencyDispatchAction(
      { uid: 'admin-1', role: 'admin' },
      'req-emergency',
      { action: 'escalate', reason: 'P0 drill' },
      queryDb,
    );

    expect(profile.dispatchStatus).toBe('escalated');
    expect(queryDb.query.mock.calls[0][0]).toMatch(/UPDATE emergency_request_profiles/);
    expect(queryDb.query.mock.calls[1][0]).toMatch(/sla_state='emergency_escalated'/);
    expect(queryDb.query.mock.calls[1][1]).toEqual(['req-emergency', 'P0 drill']);
  });
});
