'use strict';

const { RequestSlaService, normalizeAssignee } = require('../services/requests/RequestSlaService');

describe('RequestSlaService', () => {
  test('normalizeAssignee accepts technician assignment payload', () => {
    expect(normalizeAssignee({
      assigneeUid: 'tech-1',
      assigneeName: 'Техник',
      assigneeRole: 'technician',
    })).toEqual({
      assigneeUid: 'tech-1',
      assigneeName: 'Техник',
      assigneeRole: 'technician',
    });
  });

  test('normalizeAssignee rejects unsupported assignee role', () => {
    expect(() => normalizeAssignee({
      assigneeUid: 'resident-1',
      assigneeRole: 'owner',
    })).toThrow('Invalid assigneeRole');
  });

  test('assignRequest rejects stale expectedCurrentStatus', async () => {
    const queryDb = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 'req-1',
          type: 'repair',
          category: 'plumber',
          status: 'accepted',
          created_by_uid: 'resident-1',
          created_by_name: 'Resident',
          created_by_role: 'owner',
          photos: [],
          created_at: new Date(),
          updated_at: new Date(),
        }],
      }),
    };

    await expect(RequestSlaService.assignRequest(
      { uid: 'admin-1', role: 'admin' },
      'req-1',
      { assigneeUid: 'tech-1', assigneeRole: 'technician', expectedCurrentStatus: 'pending' },
      queryDb,
    )).rejects.toMatchObject({
      status: 409,
      code: 'REQUEST_CONFLICT',
      details: {
        currentStatus: 'accepted',
        expectedCurrentStatus: 'pending',
      },
    });
    expect(queryDb.query).toHaveBeenCalledTimes(1);
  });

  test('assignRequest rejects terminal requests', async () => {
    const queryDb = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 'req-1',
          type: 'repair',
          category: 'plumber',
          status: 'completed',
          created_by_uid: 'resident-1',
          created_by_name: 'Resident',
          created_by_role: 'owner',
          photos: [],
          created_at: new Date(),
          updated_at: new Date(),
        }],
      }),
    };

    await expect(RequestSlaService.assignRequest(
      { uid: 'admin-1', role: 'admin' },
      'req-1',
      { assigneeUid: 'tech-1', assigneeRole: 'technician' },
      queryDb,
    )).rejects.toMatchObject({
      status: 409,
      code: 'REQUEST_CONFLICT',
      details: { currentStatus: 'completed', terminal: true },
    });
  });

  test('escalateOverdueRequests persists SLA event and updates request state', async () => {
    const dueAt = new Date('2026-05-08T08:00:00Z');
    const queryDb = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'req-1',
            type: 'emergency',
            category: 'emergency_fire_smoke',
            priority: 'emergency',
            sla_profile: 'emergency',
            created_by_uid: 'resident-1',
            due_at: dueAt,
            event_type: 'first_response_overdue',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'evt-1',
            request_id: 'req-1',
            event_key: 'req-1:first_response_overdue',
            event_type: 'first_response_overdue',
            severity: 'emergency',
            due_at: dueAt,
            detected_at: new Date('2026-05-08T08:05:00Z'),
            metadata: { priority: 'emergency' },
            created_at: new Date('2026-05-08T08:05:00Z'),
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const events = await RequestSlaService.escalateOverdueRequests(queryDb, { limit: 10 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: 'req-1',
      eventType: 'first_response_overdue',
      severity: 'emergency',
      slaProfile: 'emergency',
    });
    expect(queryDb.query.mock.calls[1][0]).toMatch(/INSERT INTO request_sla_events/);
    expect(queryDb.query.mock.calls[2][0]).toMatch(/sla_state=CASE/);
  });

  test('escalateOverdueRequests skips state update when event already exists', async () => {
    const queryDb = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'req-2',
            type: 'repair',
            category: 'plumber',
            priority: 'normal',
            sla_profile: 'standard',
            created_by_uid: 'resident-1',
            due_at: new Date('2026-05-08T08:00:00Z'),
            event_type: 'resolution_overdue',
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const events = await RequestSlaService.escalateOverdueRequests(queryDb);

    expect(events).toEqual([]);
    expect(queryDb.query).toHaveBeenCalledTimes(2);
  });
});
