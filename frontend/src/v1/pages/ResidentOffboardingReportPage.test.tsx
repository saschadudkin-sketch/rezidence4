import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api/types';
import { V1SessionProvider } from '../store';
import { ResidentOffboardingReportPage } from './ResidentOffboardingReportPage';

const { offboardingReportMock } = vi.hoisted(() => ({
  offboardingReportMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      residents: {
        offboardingReport: offboardingReportMock,
      },
    },
    isV1ApiError: () => false,
  };
});

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_ID = '22222222-2222-4222-8222-222222222222';

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
        <ResidentOffboardingReportPage />
      </V1SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  offboardingReportMock.mockResolvedValue({
    report: {
      property_id: PROPERTY_ID,
      generated_at: '2026-05-11T10:00:00.000Z',
      summary: {
        offboarded_residents: 3,
        offboarded_last_30d: 2,
        vehicles_pending_review: 1,
        recent_offboarding_rows: 1,
      },
      recent_offboardings: [{
        id: 'event-1',
        property_id: PROPERTY_ID,
        resident_id: RESIDENT_ID,
        resident_name: 'Resident One',
        unit_id: null,
        resident_active: false,
        actor_uid: 'admin-1',
        actor_role: 'admin',
        reason: 'ownership transfer',
        summary: {
          revoked_passes: 1,
          cancelled_access_requests: 1,
          vehicles_marked_for_review: 1,
        },
        created_at: '2026-05-11T08:00:00.000Z',
      }],
      vehicle_review_queue: [{
        id: 'vehicle-1',
        owner_resident_id: RESIDENT_ID,
        plate_number: 'A001AA77',
        is_whitelisted: false,
        is_blacklisted: false,
        review_required: true,
        offboarded_at: '2026-05-11T08:00:00.000Z',
        offboarding_reason: 'ownership transfer',
      }],
      evidence: {
        source_tables: [
          'resident_lifecycle_events',
          'resident_unit_links',
          'passes',
          'access_requests',
          'vehicles',
          'property_audit_log',
        ],
        report_scope: 'resident_offboarding',
        generated_at: '2026-05-11T10:00:00.000Z',
      },
    },
  });
});

describe('ResidentOffboardingReportPage', () => {
  test('renders offboarding evidence and vehicle review queue', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: /resident offboarding/i })).toBeInTheDocument();
    expect(await screen.findByText('Resident One')).toBeInTheDocument();
    expect(screen.getByText('A001AA77')).toBeInTheDocument();
    expect(screen.getAllByText(/ownership transfer/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Tables: resident_lifecycle_events/)).toBeInTheDocument();
    expect(offboardingReportMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, limit: 25 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('shows property binding warning before fetching report', () => {
    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText('Администратор не привязан к объекту.')).toBeInTheDocument();
    expect(offboardingReportMock).not.toHaveBeenCalled();
  });
});
