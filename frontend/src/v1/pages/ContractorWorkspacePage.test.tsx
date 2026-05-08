import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  ContractorWorkspaceRequest,
  ContractorWorkspaceRequestDetail,
  UserMe,
} from '../api/types';

const {
  getRequestDetailMock,
  listQueueMock,
  resolveRequestMock,
  resumeRequestMock,
  setWaitingMock,
  startRequestMock,
} = vi.hoisted(() => ({
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
      contractorWorkspace: {
        listQueue: listQueueMock,
        getRequestDetail: getRequestDetailMock,
        startRequest: startRequestMock,
        resumeRequest: resumeRequestMock,
        setWaiting: setWaitingMock,
        resolveRequest: resolveRequestMock,
      },
    },
    isV1ApiError: () => false,
  };
});

import { ContractorWorkspacePage } from './ContractorWorkspacePage';
import { V1SessionProvider } from '../store';

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACTOR_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACTOR_COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'contractor-uid-1',
    role: 'contractor',
    name: 'Сергей Подрядчик',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'demo',
    property_id: 'prop-1',
    property_type: 'residential_complex',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ContractorWorkspaceRequest> = {}): ContractorWorkspaceRequest {
  return {
    id: 'req-1',
    type: 'repair',
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
    assignedToUid: 'contractor-uid-1',
    assignedToName: 'Сергей Подрядчик',
    assignedToRole: 'contractor',
    assignedAt: '2026-05-08T07:15:00Z',
    assignedContractorUserId: CONTRACTOR_USER_ID,
    assignedContractorCompanyId: CONTRACTOR_COMPANY_ID,
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
    contractor: {
      id: CONTRACTOR_USER_ID,
      uid: 'contractor-uid-1',
      fullName: 'Сергей Подрядчик',
      companyId: CONTRACTOR_COMPANY_ID,
      companyName: 'ООО Ремонт',
      companyStatus: 'active',
      accessExpiresAt: '2026-06-01T00:00:00Z',
    },
    workflow: {
      canStart: false,
      canResume: false,
      canWait: true,
      canResolve: true,
    },
    counters: {
      residentUpdates: 1,
      contractorEvents: 1,
    },
    ...overrides,
  };
}

function makeDetail(request = makeRequest()): ContractorWorkspaceRequestDetail {
  return {
    request,
    attachments: [{
      id: ATTACHMENT_ID,
      requestId: request.id,
      uploadedByUid: 'contractor-uid-1',
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
      actorUid: 'staff-1',
      actorName: 'Мария Консьерж',
      actorRole: 'concierge',
      body: 'Внутренний staff-only комментарий',
      visibility: 'internal',
      attachmentIds: [],
      createdAt: '2026-05-08T08:20:00Z',
    }],
    slaEvents: [{
      id: '66666666-6666-4666-8666-666666666666',
      requestId: request.id,
      eventKey: 'req-1:resolution_due',
      eventType: 'resolution_due',
      severity: 'warning',
      dueAt: '2026-05-08T10:00:00Z',
      detectedAt: null,
      metadata: {},
      createdAt: '2026-05-08T08:00:00Z',
    }],
    contractorEvents: [{
      id: '77777777-7777-4777-8777-777777777777',
      requestId: request.id,
      contractorUserId: CONTRACTOR_USER_ID,
      contractorCompanyId: CONTRACTOR_COMPANY_ID,
      contractorUid: 'contractor-uid-1',
      actorUid: 'contractor-uid-1',
      actorName: 'Сергей Подрядчик',
      actorRole: 'contractor',
      eventType: 'started',
      fromStatus: 'accepted',
      toStatus: 'in_progress',
      metadata: {},
      createdAt: '2026-05-08T08:05:00Z',
    }],
  };
}

function mockContractorData(request = makeRequest()) {
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
  mockContractorData();
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

describe('ContractorWorkspacePage', () => {
  test('loads contractor queue, detail, public attachments and contractor timeline', async () => {
    renderWithProviders(<ContractorWorkspacePage />);

    expect(await screen.findByRole('heading', { name: /портал подрядчика/i })).toBeInTheDocument();
    expect(await screen.findByText('ООО Ремонт')).toBeInTheDocument();
    expect(await screen.findByText('Дома, доступ открыт')).toBeInTheDocument();
    expect(screen.getByText('/uploads/result.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Работа начата/)).toBeInTheDocument();
    expect(screen.queryByText('Внутренний staff-only комментарий')).toBeNull();
    expect(listQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'mine', limit: 30, offset: 0 }),
      expect.any(Object),
    );
  });

  test('sends queue filters to contractor workspace API', async () => {
    renderWithProviders(<ContractorWorkspacePage />);
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

  test('starts assigned work and resumes waiting work', async () => {
    const assigned = makeRequest({
      status: 'assigned',
      startedAt: null,
      workflow: {
        canStart: true,
        canResume: false,
        canWait: false,
        canResolve: false,
      },
    });
    mockContractorData(assigned);
    const firstRender = renderWithProviders(<ContractorWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.click(screen.getByRole('button', { name: /^начать$/i }));
    await waitFor(() => {
      expect(startRequestMock).toHaveBeenCalledWith('req-1');
    });

    firstRender.unmount();
    vi.clearAllMocks();
    const waiting = makeRequest({
      status: 'waiting_parts',
      workflow: {
        canStart: false,
        canResume: true,
        canWait: false,
        canResolve: false,
      },
    });
    mockContractorData(waiting);
    renderWithProviders(<ContractorWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.click(screen.getByRole('button', { name: /^возобновить$/i }));
    await waitFor(() => {
      expect(resumeRequestMock).toHaveBeenCalledWith('req-1');
    });
  });

  test('sets waiting parts and resolves work with result fields', async () => {
    renderWithProviders(<ContractorWorkspacePage />);
    await screen.findByText('ООО Ремонт');

    fireEvent.change(screen.getByLabelText('Комментарий к ожиданию'), {
      target: { value: 'Нет фитинга' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ждём материалы/i }));
    await waitFor(() => {
      expect(setWaitingMock).toHaveBeenCalledWith(
        'req-1',
        { reason: 'parts', note: 'Нет фитинга' },
      );
    });

    fireEvent.change(screen.getByLabelText('Результат работ'), {
      target: { value: 'Заменили смеситель' },
    });
    fireEvent.change(screen.getByLabelText('Фото результата'), {
      target: { value: `${ATTACHMENT_ID}, 22222222-2222-4222-8222-222222222222` },
    });
    fireEvent.click(screen.getByLabelText(/нужен контрольный осмотр/i));
    fireEvent.click(screen.getByRole('button', { name: /сдать работу/i }));

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

  test('denies non-contractor resident locally', async () => {
    renderWithProviders(<ContractorWorkspacePage />, makeUser({ role: 'owner' }));

    expect(await screen.findByText(/доступен только подрядчикам/i)).toBeInTheDocument();
    expect(listQueueMock).not.toHaveBeenCalled();
  });
});
