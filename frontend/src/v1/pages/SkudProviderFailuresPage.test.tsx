import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api/types';
import { V1SessionProvider } from '../store';
import { SkudProviderFailuresPage } from './SkudProviderFailuresPage';

const { getProviderFailuresMock } = vi.hoisted(() => ({
  getProviderFailuresMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      skudIntegrations: {
        getProviderFailures: getProviderFailuresMock,
      },
    },
    isV1ApiError: () => false,
  };
});

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';

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

function dashboardResponse() {
  return {
    dashboard: {
      property_id: PROPERTY_ID,
      generated_at: '2026-05-11T10:00:00.000Z',
      window_hours: 24,
      summary: {
        providers_total: 1,
        providers_down: 1,
        providers_degraded: 0,
        providers_needing_attention: 1,
        failed_events: 2,
        retrying_events: 1,
        dead_lettered_events: 1,
        manual_control_events: 4,
        out_of_service_devices: 1,
      },
      providers: [{
        provider_config: {
          id: PROVIDER_ID,
          property_id: PROPERTY_ID,
          provider: 'hikvision',
          display_name: 'Main gate Hikvision',
          status: 'active',
          sync_mode: 'hybrid',
          health_status: 'down',
          last_success_at: '2026-05-10T08:00:00.000Z',
          last_failure_at: '2026-05-11T08:30:00.000Z',
          last_error: 'timeout',
        },
        event_summary: {
          total_events: 6,
          succeeded_events: 2,
          failed_events: 2,
          retrying_events: 1,
          dead_lettered_events: 1,
          pending_events: 0,
          ignored_events: 0,
          last_event_at: '2026-05-11T08:45:00.000Z',
          last_failure_event_at: '2026-05-11T08:45:00.000Z',
        },
        device_summary: {
          total_devices: 3,
          degraded_devices: 2,
          out_of_service_devices: 1,
          manual_guard_devices: 1,
          fail_closed_devices: 2,
        },
        manual_control_summary: {
          manual_control_events: 4,
          last_manual_action_at: '2026-05-11T08:50:00.000Z',
        },
        top_errors: [{
          error_code: 'provider_timeout',
          error_message: 'Controller did not respond',
          total: 2,
          last_seen_at: '2026-05-11T08:45:00.000Z',
        }],
        needs_attention: true,
        attention_reasons: [
          'provider_down',
          'failed_events',
          'retrying_events',
          'dead_lettered_events',
          'out_of_service_devices',
          'manual_control_events',
        ],
      }],
      field_rollout_evidence: {
        source_tables: [
          'skud_provider_configs',
          'skud_integration_events',
          'skud_hardware_devices',
          'hardware_manual_control_events',
        ],
        evidence_window_hours: 24,
        returned_provider_configs: 1,
        active_provider_configs: 1,
        real_failure_rows: 4,
        manual_control_event_rows: 4,
        generated_at: '2026-05-11T10:00:00.000Z',
      },
    },
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
        <SkudProviderFailuresPage />
      </V1SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProviderFailuresMock.mockResolvedValue(dashboardResponse());
});

describe('SkudProviderFailuresPage', () => {
  test('renders provider failure dashboard and field evidence', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: /скуд: отказы провайдеров/i })).toBeInTheDocument();
    expect(await screen.findByText('Main gate Hikvision')).toBeInTheDocument();
    expect(screen.getByText('provider_timeout')).toBeInTheDocument();
    expect(screen.getByText(/Controller did not respond/)).toBeInTheDocument();
    expect(screen.getByText(/Tables: skud_provider_configs, skud_integration_events/)).toBeInTheDocument();
    expect(getProviderFailuresMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, window_hours: 24, limit: 50 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('reloads when evidence window changes', async () => {
    renderPage();
    await screen.findByText('Main gate Hikvision');

    fireEvent.change(screen.getByLabelText('Окно'), { target: { value: '168' } });

    await waitFor(() => {
      expect(getProviderFailuresMock).toHaveBeenLastCalledWith(
        { property_id: PROPERTY_ID, window_hours: 168, limit: 50 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test('shows property binding warning before fetching dashboard', () => {
    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText('Администратор не привязан к объекту.')).toBeInTheDocument();
    expect(getProviderFailuresMock).not.toHaveBeenCalled();
  });
});
