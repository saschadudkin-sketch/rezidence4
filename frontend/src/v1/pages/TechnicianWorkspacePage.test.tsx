import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  TechnicianWorkspaceRequest,
  TechnicianWorkspaceRequestDetail,
  UserMe,
} from '../api/types';

const {
  claimRequestMock,
  getRequestDetailMock,
  listQueueMock,
  resolveRequestMock,
  resumeRequestMock,
  setWaitingMock,
  startRequestMock,
} = vi.hoisted(() => ({
  claimRequestMock: vi.fn(),
  getRequestDetailMock: vi.fn(),
  listQueueMock: vi.fn(),
  resolveRequestMock: vi.fn(),
  resumeRequestMock: vi.fn(),
  setWaitingMock: vi.fn(),
  startRequestMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      technicianWorkspace: {
        listQueue: listQueueMock,
        getRequestDetail: getRequestDetailMock,
        claimRequest: claimRequestMock,
        startRequest: startRequestMock,
        resumeRequest: resumeRequestMock,
        setWaiting: setWaitingMock,
        resolveRequest: resolveRequestMock,
      },
    },
    isV1ApiError: () => false,
  };
});

import { TechnicianWorkspacePage } from './TechnicianWorkspacePage';
import { V1SessionProvider } from '../store';

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'tech-1',
    role: 'technician',
    name: 'Техник',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'demo',
    property_id: 'prop-1',
    property_type: 'residential_complex',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<TechnicianWorkspaceRequest> = {}): TechnicianWorkspaceRequest {
  return {
    id: 'req-1',
    type: 'service',
    category: 'plumber',
    status: 'in_progress',
    priority: 'high',
    slaProfile: 'urgent',
    requestCategoryId: null,
    targetType: 'unit',
    targetId: '22222222-2222-4222-8222-222222222222',
    firstResponseDueAt: '2026-05-08T08:00:00Z',
    resolutionDueAt: '2026-05-08T10:00:00Z',
    dueAt: '2026-05-08T10:00:00Z',
    isOverdue: false,
    emergencyMetadata: {},
    assignedToUid: 'tech-1',
    assignedToName: 'Техник',
    assignedToRole: 'technician',
    assignedAt: '2026-05-08T07:15:00Z',
    startedAt: '2026-05-08T08:05:00Z',
    firstResponseAt: '2026-05-08T08:05:00Z',
    resolvedAt: null,
    completedAt: null,
    resolutionNote: null,
    requiresFollowUp: false,
    slaState: 'responded',
    escalationLevel: 0,
    escalatedAt: null,
    escalationReason: null,
    lastSlaCheckAt: null,
    createdByUid: 'resident-user-1',
    createdByName: 'Иван Петров',
    createdByRole: 'owner',
    createdByApt: '12',
    visitorName: null,
    visitorPhone: null,
    carPlate: null,
    comment: 'Протечка в санузле',
    passDuration: 'once',
    validUntil: null,
    scheduledFor: null,
    arrivedAt: null,
    photos: [],
    photo: null,
    createdAt: '2026-05-08T07:00:00Z',
    updatedAt: '2026-05-08T08:05:00Z',
    resident: {
      id: '33333333-3333-4333-8333-333333333333',
      uid: 'resident-user-1',
      name: 'Иван Петров',
      apt: '12',
    },
    workflow: {
      canClaim: false,
      canStart: false,
      canResume: false,
      canWait: true,
      canResolve: true,
    },
    counters: {
      residentUpdates: 1,
      internalComments: 1,
      slaEvents: 0,
      technicianEvents: 1,
    },
    ...overrides,
  };
}

function makeDetail(request = makeRequest()): TechnicianWorkspaceRequestDetail {
  return {
    request,
    attachments: [{
      id: ATTACHMENT_ID,
      requestId: request.id,
      uploadedByUid: 'tech-1',
      fileUrl: '/uploads/result.jpg',
      fileKind: 'photo',
      visibility: 'resident',
      metadata: {},
      createdAt: '2026-05-08T08:15:00Z',
    }],
    residentUpdates: [{
      id: '44444444-4444-4444-8444-444444444444',
      requestId: request.id,
      actorUid: 'resident-user-1',
      actorName: 'Иван Петров',
      actorRole: 'owner',
      body: 'Дома, доступ открыт',
      visibility: 'resident',
      attachmentIds: [],
      createdAt: '2026-05-08T08:10:00Z',
    }],
    internalComments: [{
      id: '55555555-5555-4555-8555-555555555555',
      requestId: request.id,
      actorUid: 'tech-1',
      actorName: 'Техник',
      actorRole: 'technician',
      body: 'Проверяю узел ввода',
      visibility: 'internal',
      attachmentIds: [],
      createdAt: '2026-05-08T08:20:00Z',
    }],
    slaEvents: [],
    technicianEvents: [{
      id: '66666666-6666-4666-8666-666666666666',
      requestId: request.id,
      technicianUid: 'tech-1',
      actorUid: 'tech-1',
      actorName: 'Техник',
      actorRole: 'technician',
      eventType: 'started',
      fromStatus: 'accepted',
      toStatus: 'in_progress',
      metadata: {},
      createdAt: '2026-05-08T08:05:00Z',
    }],
  };
}

function mockTechnicianData(request = makeRequest()) {
  listQueueMock.mockResolvedValue({
    requests: [request],
    total: 1,
    page: { limit: 30, offset: 0, hasMore: false },
  });
  getRequestDetailMock.mockResolvedValue(makeDetail(request));
}

function renderWithProviders(node: ReactElement, user = makeUser()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <V1SessionProvider initialUser={user}>{node}</V1SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockTechnicianData();
  claimRequestMock.mockResolvedValue({ request: makeRequest({ assignedToUid: 'tech-1' }) });
  startRequestMock.mockResolvedValue({ request: makeRequest({ status: 'in_progress' }) });
  resumeRequestMock.mockResolvedValue({ request: makeRequest({ status: 'in_progress' }) });
  setWaitingMock.mockResolvedValue({ request: makeRequest({ status: 'waiting_parts' }) });
  resolveRequestMock.mockResolvedValue({
    request: makeRequest({
      status: 'resolved',
      resolutionNote: 'Заменили смеситель',
      requiresFollowUp: true,
    }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TechnicianWorkspacePage', () => {
  test('loads technician queue, detail, attachments and timelines', async () => {
    renderWithProviders(<TechnicianWorkspacePage />);

    expect(await screen.findByRole('heading', { name: /рабочее место техника/i })).toBeInTheDocument();
    expect(await screen.findByText('Проверяю узел ввода')).toBeInTheDocument();
    expect(screen.getByText('Дома, доступ открыт')).toBeInTheDocument();
    expect(screen.getByText('/uploads/result.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Работа начата/)).toBeInTheDocument();
    expect(listQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'mine', limit: 30, offset: 0 }),
      expect.any(Object),
    );
  });

  test('sends queue filters to technician workspace API', async () => {
    renderWithProviders(<TechnicianWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.change(screen.getByLabelText('Очередь'), { target: { value: 'waiting' } });
    await waitFor(() => {
      expect(listQueueMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ queue: 'waiting' }),
        expect.any(Object),
      );
    });

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'Ив' } });
    await waitFor(() => {
      expect(listQueueMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ queue: 'waiting', q: 'Ив' }),
        expect.any(Object),
      );
    });
  });

  test('claims available work and starts assigned work', async () => {
    const available = makeRequest({
      status: 'pending',
      assignedToUid: null,
      assignedToName: null,
      assignedToRole: null,
      workflow: {
        canClaim: true,
        canStart: false,
        canResume: false,
        canWait: false,
        canResolve: false,
      },
    });
    mockTechnicianData(available);
    const firstRender = renderWithProviders(<TechnicianWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.click(screen.getByRole('button', { name: /взять задачу/i }));
    await waitFor(() => {
      expect(claimRequestMock).toHaveBeenCalledWith('req-1');
    });

    firstRender.unmount();
    vi.clearAllMocks();
    const assigned = makeRequest({
      status: 'accepted',
      workflow: {
        canClaim: false,
        canStart: true,
        canResume: false,
        canWait: false,
        canResolve: false,
      },
    });
    mockTechnicianData(assigned);
    renderWithProviders(<TechnicianWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.click(screen.getByRole('button', { name: /^начать$/i }));
    await waitFor(() => {
      expect(startRequestMock).toHaveBeenCalledWith('req-1');
    });
  });

  test('sets waiting state and resolves work with result fields', async () => {
    renderWithProviders(<TechnicianWorkspacePage />);
    await screen.findByText('Проверяю узел ввода');

    fireEvent.change(screen.getByLabelText('Ожидание'), { target: { value: 'parts' } });
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Нужен смеситель' } });
    fireEvent.click(screen.getByRole('button', { name: /поставить на ожидание/i }));
    await waitFor(() => {
      expect(setWaitingMock).toHaveBeenCalledWith(
        'req-1',
        { reason: 'parts', note: 'Нужен смеситель' },
      );
    });

    fireEvent.change(screen.getByLabelText('Результат работ'), {
      target: { value: 'Заменили смеситель' },
    });
    fireEvent.change(screen.getByLabelText('Фото результата'), {
      target: { value: `${ATTACHMENT_ID}, 22222222-2222-4222-8222-222222222222` },
    });
    fireEvent.click(screen.getByLabelText(/нужен контрольный осмотр/i));
    fireEvent.click(screen.getByRole('button', { name: /завершить задачу/i }));

    await waitFor(() => {
      expect(resolveRequestMock).toHaveBeenCalledWith(
        'req-1',
        {
          resolutionNote: 'Заменили смеситель',
          requiresFollowUp: true,
          attachmentIds: [
            ATTACHMENT_ID,
            '22222222-2222-4222-8222-222222222222',
          ],
        },
      );
    });
  });

  test('denies non-technician resident locally', async () => {
    renderWithProviders(<TechnicianWorkspacePage />, makeUser({ role: 'owner' }));

    expect(await screen.findByText(/доступно только техникам/i)).toBeInTheDocument();
    expect(listQueueMock).not.toHaveBeenCalled();
  });
});
