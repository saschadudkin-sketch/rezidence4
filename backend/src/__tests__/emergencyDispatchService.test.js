'use strict';

const {
  buildEmergencyProfileInput,
  createEmergencyDrillRecord,
  createEmergencyProfileForRequest,
  listEmergencyReadiness,
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

  test('listEmergencyReadiness aggregates queue, roster, notification and drill evidence', async () => {
    const queryDb = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            active_emergencies: 2,
            p0_active: 1,
            first_response_overdue: 1,
            resolution_overdue: 0,
            notification_failed: 1,
            notification_sent: 3,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'profile-1',
            property_id: '11111111-1111-4111-8111-111111111111',
            request_id: 'req-emergency',
            emergency_type: 'fire_smoke',
            severity: 'P0',
            dispatch_status: 'new',
            escalation_target: 'security',
            notification_status: 'failed',
            metadata: {},
            request_type: 'emergency',
            request_category: 'emergency_fire_smoke',
            request_status: 'pending',
            created_by_uid: 'resident-1',
            created_by_name: 'Resident',
            created_by_role: 'owner',
            comment: 'Smoke',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'roster-1',
            property_id: '11111111-1111-4111-8111-111111111111',
            escalation_target: 'security',
            display_name: 'Security duty',
            provider: 'telegram',
            contact_ref: 'telegram:on-call',
            status: 'active',
            priority: 10,
            metadata: { shift: 'night' },
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            channel: 'telegram',
            status: 'failed',
            total: 1,
            failed: 1,
            last_event_at: new Date('2026-05-08T08:02:00Z'),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'drill-1',
            property_id: '11111111-1111-4111-8111-111111111111',
            scenario_type: 'fire_smoke',
            severity: 'P0',
            escalation_target: 'security',
            status: 'passed',
            created_by_uid: 'admin-1',
            findings: { guard_ack_minutes: 2 },
            notification_evidence: { telegram: 'sent' },
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'delivery-1',
            property_id: '11111111-1111-4111-8111-111111111111',
            request_id: 'req-emergency',
            drill_id: 'drill-1',
            provider: 'telegram',
            channel: 'telegram',
            scenario_type: 'fire_smoke',
            status: 'acknowledged',
            latency_ms: 1200,
            external_delivery_id: 'tg-1',
            payload: { ack_by: 'guard' },
          }],
        }),
    };

    const report = await listEmergencyReadiness(
      { uid: 'admin-1', role: 'admin', property_id: '11111111-1111-4111-8111-111111111111' },
      queryDb,
      { window_hours: 72, limit: 10 },
    );

    expect(report.summary).toMatchObject({
      active_emergencies: 2,
      p0_active: 1,
      notification_failed: 1,
      active_on_call_rows: 1,
      drill_records: 1,
      provider_delivery_evidence_rows: 1,
    });
    expect(report.queue[0]).toMatchObject({ emergencyType: 'fire_smoke', request: { category: 'emergency_fire_smoke' } });
    expect(report.on_call_roster[0]).toMatchObject({ escalationTarget: 'security', provider: 'telegram' });
    expect(report.provider_notification_evidence[0]).toMatchObject({ channel: 'telegram', failed: 1 });
    expect(report.live_provider_delivery_evidence[0]).toMatchObject({ provider: 'telegram', status: 'acknowledged' });
    expect(report.evidence.source_tables).toContain('emergency_dispatch_drills');
    expect(report.evidence.source_tables).toContain('emergency_provider_delivery_evidence');
    expect(queryDb.query.mock.calls[0][0]).toMatch(/COUNT\(\*\) FILTER/);
    expect(queryDb.query.mock.calls[3][0]).toMatch(/notification_log/);
  });

  test('createEmergencyDrillRecord persists operational drill evidence', async () => {
    const queryDb = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 'drill-1',
          property_id: '11111111-1111-4111-8111-111111111111',
          scenario_type: 'access_control',
          severity: 'P1',
          escalation_target: 'security',
          request_id: 'req-1',
          status: 'passed',
          started_at: new Date('2026-05-08T08:00:00Z'),
          completed_at: new Date('2026-05-08T08:05:00Z'),
          created_by_uid: 'admin-1',
          summary: 'Barrier failure drill',
          findings: { fallback: 'manual_guard' },
          notification_evidence: { push: 'sent' },
        }],
      }),
    };

    const drill = await createEmergencyDrillRecord(
      { uid: 'admin-1', role: 'admin', property_id: '11111111-1111-4111-8111-111111111111' },
      queryDb,
      {
        scenarioType: 'access_control',
        severity: 'P1',
        escalationTarget: 'security',
        requestId: 'req-1',
        summary: 'Barrier failure drill',
        findings: { fallback: 'manual_guard' },
        notificationEvidence: { push: 'sent' },
      },
    );

    expect(drill).toMatchObject({
      scenarioType: 'access_control',
      severity: 'P1',
      status: 'passed',
      notificationEvidence: { push: 'sent' },
    });
    expect(queryDb.query.mock.calls[0][0]).toMatch(/INSERT INTO emergency_dispatch_drills/);
    expect(queryDb.query.mock.calls[0][1][0]).toBe('11111111-1111-4111-8111-111111111111');
  });

  test('records live provider delivery evidence', async () => {
    const queryDb = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 'delivery-1',
          property_id: '11111111-1111-4111-8111-111111111111',
          request_id: 'req-emergency',
          provider: 'telegram',
          channel: 'telegram',
          scenario_type: 'fire_smoke',
          status: 'delivered',
          latency_ms: 900,
          external_delivery_id: 'tg-delivery-1',
          payload: { provider_status: 'ok' },
        }],
      }),
    };

    const { recordEmergencyProviderDeliveryEvidence } = require('../services/requests/EmergencyDispatchService');
    const evidence = await recordEmergencyProviderDeliveryEvidence(
      { uid: 'admin-1', role: 'admin', property_id: '11111111-1111-4111-8111-111111111111' },
      queryDb,
      {
        requestId: 'req-emergency',
        provider: 'telegram',
        channel: 'telegram',
        scenarioType: 'fire_smoke',
        status: 'delivered',
        latencyMs: 900,
        externalDeliveryId: 'tg-delivery-1',
        payload: { provider_status: 'ok' },
      },
    );

    expect(evidence).toMatchObject({ provider: 'telegram', status: 'delivered', latencyMs: 900 });
    expect(queryDb.query.mock.calls[0][0]).toMatch(/INSERT INTO emergency_provider_delivery_evidence/);
  });
});
