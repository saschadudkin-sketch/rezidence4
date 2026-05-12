import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserMe } from '../api/types';
import { V1SessionProvider } from '../store';
import { SensitiveActionsReviewPage } from './SensitiveActionsReviewPage';

const {
  antiAbuseMock,
  listMock,
  metaMock,
  summaryMock,
} = vi.hoisted(() => ({
  antiAbuseMock: vi.fn(),
  listMock: vi.fn(),
  metaMock: vi.fn(),
  summaryMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      auditReviews: {
        meta: metaMock,
        summary: summaryMock,
        antiAbuse: antiAbuseMock,
        list: listMock,
      },
    },
    isV1ApiError: () => false,
  };
});

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const AUDIT_ID = '22222222-2222-4222-8222-222222222222';

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
        <SensitiveActionsReviewPage />
      </V1SessionProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  metaMock.mockResolvedValue({
    categories: ['manual_override', 'provider_settings'],
    actions: ['override.created'],
    review_statuses: ['pending', 'approved', 'needs_followup', 'dismissed'],
    priorities: ['low', 'normal', 'high', 'urgent'],
    escalation_statuses: ['none', 'overdue', 'escalated'],
  });
  summaryMock.mockResolvedValue({
    summary: {
      rows: [
        { review_status: 'pending', priority: 'urgent', total: 2, overdue: 1 },
        { review_status: 'approved', priority: 'normal', total: 3, overdue: 0 },
      ],
      totals: {
        total: 5,
        overdue: 1,
        by_status: { pending: 2, approved: 3 },
        by_priority: { urgent: 2, normal: 3 },
      },
    },
  });
  antiAbuseMock.mockResolvedValue({
    analytics: {
      summary: {
        total_findings: 1,
        actors: 1,
        high_risk_actions: 6,
        overdue_reviews: 1,
      },
      findings: [{
        actor_uid: 'guard-1',
        actor_role: 'security',
        category: 'manual_override',
        total_actions: 6,
        high_risk_actions: 6,
        pending_reviews: 3,
        overdue_reviews: 1,
        off_hours_actions: 2,
        distinct_resources: 4,
        first_seen_at: '2026-05-10T00:00:00.000Z',
        last_seen_at: '2026-05-11T00:00:00.000Z',
        flags: ['high_volume', 'off_hours', 'overdue_reviews'],
        risk_score: 25,
      }],
    },
  });
  listMock.mockResolvedValue({
    actions: [{
      id: AUDIT_ID,
      property_id: PROPERTY_ID,
      actor_uid: 'guard-1',
      actor_role: 'security',
      actor_type: 'staff',
      action: 'override.created',
      resource_type: 'access_override',
      resource_id: 'override-1',
      entity_type: null,
      entity_id: null,
      changes: {},
      ip_address: '127.0.0.1',
      created_at: '2026-05-11T08:00:00.000Z',
      canonical_event_type: 'access.manual_override.created',
      category: 'manual_override',
      sensitivity: 'restricted',
      sensitive: true,
      review_required: true,
      review_reason: 'manual override requires review',
      review: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'pending',
        reviewer_staff_id: null,
        reviewed_at: null,
        comment: null,
        assignment: {
          assigned_reviewer_staff_id: null,
          assigned_by_staff_id: null,
          assigned_at: null,
          due_at: '2026-05-11T09:00:00.000Z',
          priority: 'urgent',
          assignment_reason: null,
          escalation_status: 'overdue',
          escalation_note: 'due_at breached',
          last_escalated_at: '2026-05-11T10:00:00.000Z',
          overdue: true,
        },
      },
    }],
    page: { limit: 20, offset: 0, hasMore: false },
  });
});

describe('SensitiveActionsReviewPage', () => {
  test('renders summary, anti-abuse findings and pending review queue', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: /sensitive action review/i })).toBeInTheDocument();
    expect(await screen.findByText('guard-1')).toBeInTheDocument();
    expect(screen.getByText('access.manual_override.created')).toBeInTheDocument();
    expect(screen.getByText('Высокий объём')).toBeInTheDocument();
    expect(screen.getByText('Просрочено')).toBeInTheDocument();
    expect(summaryMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, category: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(antiAbuseMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, category: undefined, window_hours: 168, min_actions: 5, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listMock).toHaveBeenCalledWith(
      { property_id: PROPERTY_ID, category: undefined, review_status: 'pending', limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test('reloads reports when category changes', async () => {
    renderPage();
    await screen.findByText('guard-1');

    fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'manual_override' } });

    await waitFor(() => {
      expect(summaryMock).toHaveBeenLastCalledWith(
        { property_id: PROPERTY_ID, category: 'manual_override' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test('shows property binding warning before fetching reports', () => {
    renderPage(makeUser({ property_id: null }));

    expect(screen.getByText('Администратор не привязан к объекту.')).toBeInTheDocument();
    expect(metaMock).not.toHaveBeenCalled();
    expect(summaryMock).not.toHaveBeenCalled();
    expect(antiAbuseMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });
});
