import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api/types';
import { V1SessionProvider } from '../store';
import { EmergencyDispatchPage } from './EmergencyDispatchPage';

const { readinessMock, createDrillMock } = vi.hoisted(() => ({
  readinessMock: vi.fn(),
  createDrillMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      emergencyDispatch: {
        readiness: readinessMock,
        createDrill: createDrillMock,
      },
    },
    isV1ApiError: () => false,
  };
});

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'admin-1',
    role: 'admin',
    name: 'Admin',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechie',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function renderPage(user: UserMe = makeUser()): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <V1SessionProvider initialUser={user}>
        <EmergencyDispatchPage />
      </V1SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  readinessMock.mockResolvedValue({
    property_id: PROPERTY_ID,
    generated_at: '2026-05-11T10:00:00.000Z',
    window_hours: 72,
    summary: {
      active_emergencies: 1,
      p0_active: 1,
      first_response_overdue: 0,
      resolution_overdue: 0,
      notification_sent: 2,
      notification_failed: 1,
      active_on_call_rows: 1,
      drill_records: 1,
    },
    queue: [{
      id: '22222222-2222-4222-8222-222222222222',
      propertyId: PROPERTY_ID,
      requestId: 'request-emergency-1',
      emergencyType: 'fire_smoke',
      severity: 'P0',
      dispatchStatus: 'new',
      escalationTarget: 'security',
      firstResponseDueAt: '2026-05-11T10:05:00.000Z',
      resolutionDueAt: '2026-05-11T11:00:00.000Z',
      acknowledgedAt: null,
      acknowledgedByUid: null,
      dispatchedAt: null,
      dispatchedByUid: null,
      escalatedAt: null,
      escalatedByUid: null,
      resolvedAt: null,
      notificationStatus: 'failed',
      metadata: {},
      createdAt: '2026-05-11T10:00:00.000Z',
      updatedAt: '2026-05-11T10:00:00.000Z',
      request: {
        type: 'emergency',
        category: 'emergency_fire_smoke',
        status: 'pending',
        createdByUid: 'resident-1',
        createdByName: 'Resident One',
        createdByRole: 'owner',
        comment: 'Smoke in lobby',
      },
    }],
    on_call_roster: [{
      id: '33333333-3333-4333-8333-333333333333',
      propertyId: PROPERTY_ID,
      escalationTarget: 'security',
      displayName: 'Security on-call',
      provider: 'telegram',
      contactRef: 'telegram:on-call',
      status: 'active',
      startsAt: null,
      endsAt: null,
      priority: 10,
      metadata: {},
      updatedAt: '2026-05-11T09:00:00.000Z',
    }],
    provider_notification_evidence: [{
      channel: 'telegram',
      status: 'failed',
      total: 1,
      failed: 1,
      lastEventAt: '2026-05-11T10:02:00.000Z',
    }],
    drill_records: [{
      id: '44444444-4444-4444-8444-444444444444',
      propertyId: PROPERTY_ID,
      scenarioType: 'access_control',
      severity: 'P1',
      escalationTarget: 'security',
      requestId: null,
      status: 'passed',
      startedAt: '2026-05-11T08:00:00.000Z',
      completedAt: '2026-05-11T08:05:00.000Z',
      createdByUid: 'admin-1',
      summary: 'Barrier fallback drill',
      findings: {},
      notificationEvidence: {},
      createdAt: '2026-05-11T08:00:00.000Z',
      updatedAt: '2026-05-11T08:05:00.000Z',
    }],
    evidence: {
      source_tables: [
        'emergency_request_profiles',
        'requests',
        'emergency_on_call_rosters',
        'notification_log',
        'emergency_dispatch_drills',
      ],
      notification_event_type: 'request.emergency_created',
      returned_queue_rows: 1,
      returned_roster_rows: 1,
      returned_notification_rows: 1,
      returned_drill_rows: 1,
      generated_at: '2026-05-11T10:00:00.000Z',
    },
  });
  createDrillMock.mockResolvedValue({
    drill: {
      id: '55555555-5555-4555-8555-555555555555',
      propertyId: PROPERTY_ID,
      scenarioType: 'access_control',
      severity: 'P1',
      escalationTarget: 'security',
      requestId: null,
      status: 'passed',
      startedAt: '2026-05-11T10:30:00.000Z',
      completedAt: '2026-05-11T10:35:00.000Z',
      createdByUid: 'admin-1',
      summary: 'Guard acknowledged',
      findings: {},
      notificationEvidence: {},
      createdAt: '2026-05-11T10:30:00.000Z',
      updatedAt: '2026-05-11T10:35:00.000Z',
    },
  });
});

describe('EmergencyDispatchPage', () => {
  test('renders queue, roster, provider evidence and drill records', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: /emergency dispatch/i })).toBeInTheDocument();
    expect(await screen.findByText('Smoke in lobby')).toBeInTheDocument();
    expect(screen.getAllByText('Пожар / дым').length).toBeGreaterThan(0);
    expect(screen.getByText('Security on-call')).toBeInTheDocument();
    expect(screen.getByText('telegram')).toBeInTheDocument();
    expect(screen.getByText('Barrier fallback drill')).toBeInTheDocument();
    expect(screen.getByText(/Tables: emergency_request_profiles/)).toBeInTheDocument();
    expect(readinessMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, window_hours: 72, limit: 25 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('records drill evidence from the admin page', async () => {
    renderPage();

    await screen.findByText('Security on-call');
    fireEvent.change(screen.getByLabelText('Итог'), {
      target: { value: 'Guard acknowledged' },
    });
    fireEvent.click(screen.getByRole('button', { name: /записать drill/i }));

    await waitFor(() => {
      expect(createDrillMock).toHaveBeenCalledWith(
        expect.objectContaining({
          property_id: PROPERTY_ID,
          scenarioType: 'access_control',
          severity: 'P1',
          escalationTarget: 'security',
          status: 'passed',
          summary: 'Guard acknowledged',
        }),
      );
    });
  });

  test('shows property binding warning before fetching readiness', () => {
    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText('Администратор не привязан к объекту.')).toBeInTheDocument();
    expect(readinessMock).not.toHaveBeenCalled();
  });
});
