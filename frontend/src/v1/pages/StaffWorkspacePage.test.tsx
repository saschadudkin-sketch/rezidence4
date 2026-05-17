import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  StaffResidentQuickView,
  StaffWorkspaceRequest,
  StaffWorkspaceRequestDetail,
  UserMe,
} from '../api/types';

const {
  assignRequestMock,
  createInternalCommentMock,
  createServiceRequestUpdateMock,
  createServiceRequestMock,
  updateServiceRequestMock,
  deleteServiceRequestMock,
  assignServiceRequestMock,
  markServiceRequestFirstResponseMock,
  upsertServiceRequestCategoryMock,
  createServiceRequestAttachmentMock,
  rateServiceRequestMock,
  listServiceRequestsMock,
  emergencyQueueMock,
  getServiceRequestByIdMock,
  getQuickViewMock,
  getRequestAttachmentsMock,
  getRequestDetailMock,
  getRequestHistoryMock,
  getRequestUpdatesMock,
  listCategoriesMock,
  listInboxMock,
  markFirstResponseMock,
  updateStatusMock,
} = vi.hoisted(() => ({
  assignRequestMock: vi.fn(),
  createInternalCommentMock: vi.fn(),
  createServiceRequestUpdateMock: vi.fn(),
  createServiceRequestMock: vi.fn(),
  updateServiceRequestMock: vi.fn(),
  deleteServiceRequestMock: vi.fn(),
  assignServiceRequestMock: vi.fn(),
  markServiceRequestFirstResponseMock: vi.fn(),
  upsertServiceRequestCategoryMock: vi.fn(),
  createServiceRequestAttachmentMock: vi.fn(),
  rateServiceRequestMock: vi.fn(),
  listServiceRequestsMock: vi.fn(),
  emergencyQueueMock: vi.fn(),
  getServiceRequestByIdMock: vi.fn(),
  getQuickViewMock: vi.fn(),
  getRequestAttachmentsMock: vi.fn(),
  getRequestDetailMock: vi.fn(),
  getRequestHistoryMock: vi.fn(),
  getRequestUpdatesMock: vi.fn(),
  listCategoriesMock: vi.fn(),
  listInboxMock: vi.fn(),
  markFirstResponseMock: vi.fn(),
  updateStatusMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      staffWorkspace: {
        listInbox: listInboxMock,
        getRequestDetail: getRequestDetailMock,
        createInternalComment: createInternalCommentMock,
        getResidentQuickView: getQuickViewMock,
        assignRequest: assignRequestMock,
        markFirstResponse: markFirstResponseMock,
        updateStatus: updateStatusMock,
      },
      serviceRequests: {
        list: listServiceRequestsMock,
        create: createServiceRequestMock,
        listCategories: listCategoriesMock,
        upsertCategory: upsertServiceRequestCategoryMock,
        getById: getServiceRequestByIdMock,
        update: updateServiceRequestMock,
        delete: deleteServiceRequestMock,
        assign: assignServiceRequestMock,
        markFirstResponse: markServiceRequestFirstResponseMock,
        getHistory: getRequestHistoryMock,
        listAttachments: getRequestAttachmentsMock,
        createAttachment: createServiceRequestAttachmentMock,
        listUpdates: getRequestUpdatesMock,
        createUpdate: createServiceRequestUpdateMock,
        rate: rateServiceRequestMock,
        emergencyQueue: emergencyQueueMock,
      },
    },
    isV1ApiError: () => false,
  };
});

import { StaffWorkspacePage } from './StaffWorkspacePage';
import { V1SessionProvider } from '../store';

const RESIDENT_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: 'staff-1',
    role: 'concierge',
    name: 'Мария Консьерж',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'demo',
    property_id: 'prop-1',
    property_type: 'residential_complex',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<StaffWorkspaceRequest> = {}): StaffWorkspaceRequest {
  return {
    id: 'req-1',
    type: 'service',
    category: 'plumber',
    status: 'pending',
    priority: 'emergency',
    slaProfile: 'emergency',
    requestCategoryId: null,
    targetType: 'unit',
    targetId: '22222222-2222-4222-8222-222222222222',
    firstResponseDueAt: '2026-05-08T08:00:00Z',
    resolutionDueAt: '2026-05-08T10:00:00Z',
    dueAt: '2026-05-08T08:00:00Z',
    isOverdue: true,
    emergencyMetadata: {},
    assignedToUid: null,
    assignedToName: null,
    assignedToRole: null,
    assignedAt: null,
    assignedContractorUserId: null,
    assignedContractorCompanyId: null,
    startedAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    completedAt: null,
    resolutionNote: null,
    requiresFollowUp: false,
    slaState: 'emergency_escalated',
    escalationLevel: 1,
    escalatedAt: '2026-05-08T08:05:00Z',
    escalationReason: 'first_response_overdue',
    lastSlaCheckAt: '2026-05-08T08:05:00Z',
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
      id: RESIDENT_ID,
      uid: 'resident-user-1',
      name: 'Иван Петров',
      apt: '12',
    },
    counters: {
      residentUpdates: 1,
      internalComments: 1,
      slaEvents: 1,
    },
    ...overrides,
  };
}

function makeDetail(request = makeRequest()): StaffWorkspaceRequestDetail {
  return {
    request,
    attachments: [],
    residentUpdates: [{
      id: '33333333-3333-4333-8333-333333333333',
      requestId: request.id,
      actorUid: 'resident-user-1',
      actorName: 'Иван Петров',
      actorRole: 'owner',
      body: 'Вода перекрыта',
      visibility: 'resident',
      attachmentIds: [],
      createdAt: '2026-05-08T07:10:00Z',
    }],
    internalComments: [{
      id: '44444444-4444-4444-8444-444444444444',
      requestId: request.id,
      actorUid: 'staff-1',
      actorName: 'Мария Консьерж',
      actorRole: 'concierge',
      body: 'Вызвали сантехника',
      visibility: 'internal',
      attachmentIds: [],
      createdAt: '2026-05-08T07:20:00Z',
    }],
    slaEvents: [{
      id: '55555555-5555-4555-8555-555555555555',
      requestId: request.id,
      eventKey: 'req-1:first_response_overdue',
      eventType: 'first_response_overdue',
      severity: 'emergency',
      dueAt: '2026-05-08T08:00:00Z',
      detectedAt: '2026-05-08T08:05:00Z',
      metadata: {},
      createdAt: '2026-05-08T08:05:00Z',
    }],
  };
}

function makeQuickView(): StaffResidentQuickView {
  return {
    resident: {
      id: RESIDENT_ID,
      externalUid: 'resident-user-1',
      propertyId: '22222222-2222-4222-8222-222222222222',
      fullName: 'Иван Петров',
      phone: '+79990001122',
      email: null,
      role: 'resident',
      residentType: 'owner',
      isActive: true,
      unit: {
        id: '66666666-6666-4666-8666-666666666666',
        number: '12',
        type: 'apartment',
        floor: 3,
        buildingId: null,
        buildingName: null,
        buildingCode: null,
        entranceId: null,
        entranceName: null,
        entranceCode: null,
      },
    },
    vehicles: [{
      id: '77777777-7777-4777-8777-777777777777',
      property_id: '22222222-2222-4222-8222-222222222222',
      plate_number: 'A001AA77',
      vehicle_type: 'car',
      color: null,
      brand: null,
      model: null,
      is_whitelisted: true,
      is_blacklisted: false,
    }],
    requestCounts: { pending: 2 },
    recentRequests: [],
  };
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
  const request = makeRequest();
  listInboxMock.mockResolvedValue({
    requests: [request],
    total: 1,
    page: { limit: 30, offset: 0, hasMore: false },
    property: null,
  });
  listCategoriesMock.mockResolvedValue({
    data: [{
      id: null,
      code: 'plumber',
      name: 'Plumber',
      domain: 'service',
      targetScope: 'unit',
      priority: 'normal',
      slaProfile: 'standard',
      firstResponseMinutes: 60,
      resolutionMinutes: 240,
      isEmergency: false,
      metadata: {},
    }],
  });
  listServiceRequestsMock.mockResolvedValue({
    data: [request],
    total: 1,
    page: 1,
    limit: 10,
    meta: { limit: 10, offset: 0, hasMore: false },
  });
  emergencyQueueMock.mockResolvedValue({
    data: [{
      id: 'emergency-1',
      propertyId: 'prop-1',
      requestId: request.id,
      emergencyType: 'water',
      severity: 'P1',
      dispatchStatus: 'new',
      escalationTarget: 'technician',
      firstResponseDueAt: '2026-05-08T08:00:00Z',
      resolutionDueAt: '2026-05-08T10:00:00Z',
      acknowledgedAt: null,
      acknowledgedByUid: null,
      dispatchedAt: null,
      dispatchedByUid: null,
      escalatedAt: null,
      escalatedByUid: null,
      resolvedAt: null,
      notificationStatus: 'pending',
      metadata: {},
      createdAt: '2026-05-08T07:00:00Z',
      updatedAt: null,
      request: {
        type: 'service',
        category: 'plumber',
        status: 'pending',
        createdByUid: 'resident-user-1',
        createdByName: 'Иван Петров',
        createdByRole: 'owner',
        comment: 'Протечка в санузле',
      },
    }],
  });
  getRequestDetailMock.mockResolvedValue(makeDetail(request));
  getServiceRequestByIdMock.mockResolvedValue(request);
  getRequestHistoryMock.mockResolvedValue([{
    byName: 'Мария Консьерж',
    byRole: 'concierge',
    action: 'Заявка принята',
    at: '2026-05-08T07:30:00Z',
  }]);
  getRequestAttachmentsMock.mockResolvedValue({
    data: [{
      id: '99999999-9999-4999-8999-999999999999',
      requestId: request.id,
      uploadedByUid: 'resident-user-1',
      fileUrl: '/uploads/leak.jpg',
      fileKind: 'photo',
      visibility: 'resident',
      metadata: {},
      createdAt: '2026-05-08T07:05:00Z',
    }],
  });
  getRequestUpdatesMock.mockResolvedValue({
    data: makeDetail(request).residentUpdates,
  });
  getQuickViewMock.mockResolvedValue(makeQuickView());
  createInternalCommentMock.mockResolvedValue({
    comment: {
      id: '88888888-8888-4888-8888-888888888888',
      requestId: request.id,
      actorUid: 'staff-1',
      actorName: 'Мария Консьерж',
      actorRole: 'concierge',
      body: 'Передали инженеру',
      visibility: 'internal',
      attachmentIds: [],
      createdAt: '2026-05-08T08:10:00Z',
    },
  });
  assignRequestMock.mockResolvedValue(makeRequest({ assignedToUid: 'staff-1' }));
  markFirstResponseMock.mockResolvedValue(makeRequest({ firstResponseAt: '2026-05-08T08:10:00Z' }));
  updateStatusMock.mockResolvedValue(makeRequest({ status: 'accepted' }));
  createServiceRequestUpdateMock.mockResolvedValue({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestId: request.id,
    actorUid: 'staff-1',
    actorName: 'Мария Консьерж',
    actorRole: 'concierge',
    body: 'Мастер едет',
    visibility: 'resident',
    attachmentIds: [],
    createdAt: '2026-05-08T08:15:00Z',
  });
  createServiceRequestMock.mockResolvedValue(makeRequest({ id: 'req-new' }));
  updateServiceRequestMock.mockResolvedValue(makeRequest({ status: 'in_progress' }));
  deleteServiceRequestMock.mockResolvedValue({ ok: true });
  assignServiceRequestMock.mockResolvedValue(makeRequest({ assignedToUid: 'staff-1' }));
  markServiceRequestFirstResponseMock.mockResolvedValue(makeRequest({ firstResponseAt: '2026-05-08T08:20:00Z' }));
  upsertServiceRequestCategoryMock.mockResolvedValue({
    id: null,
    code: 'plumber',
    name: 'Plumber updated',
    domain: 'service',
    targetScope: 'unit',
    priority: 'normal',
    slaProfile: 'standard',
    firstResponseMinutes: 60,
    resolutionMinutes: 240,
    isEmergency: false,
    metadata: {},
  });
  createServiceRequestAttachmentMock.mockResolvedValue({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requestId: request.id,
    uploadedByUid: 'staff-1',
    fileUrl: '/uploads/evidence.jpg',
    fileKind: 'photo',
    visibility: 'resident',
    metadata: {},
    createdAt: '2026-05-08T08:25:00Z',
  });
  rateServiceRequestMock.mockResolvedValue({ ok: true, rating: { value: 5 } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('StaffWorkspacePage', () => {
  test('loads inbox, selected request detail, resident quick view and timelines', async () => {
    renderWithProviders(<StaffWorkspacePage />);

    expect(await screen.findByRole('heading', { name: /рабочее место staff/i })).toBeInTheDocument();
    expect(await screen.findByText('Вызвали сантехника')).toBeInTheDocument();
    expect(screen.getByText('Вода перекрыта')).toBeInTheDocument();
    expect(screen.getByText(/\/uploads\/leak\.jpg/)).toBeInTheDocument();
    expect(screen.getByText('Заявка принята')).toBeInTheDocument();
    expect(screen.getByText(/A001AA77/)).toBeInTheDocument();
    expect(getQuickViewMock).toHaveBeenCalledWith(RESIDENT_ID, expect.any(Object));
    expect(listInboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'active', limit: 30, offset: 0 }),
      expect.any(Object),
    );
    expect(listCategoriesMock).toHaveBeenCalledWith(
      { propertyId: 'prop-1' },
      expect.any(Object),
    );
  });

  test('sends queue filters to the staff workspace API', async () => {
    renderWithProviders(<StaffWorkspacePage />);
    await screen.findByText('Протечка в санузле');

    fireEvent.change(screen.getByLabelText('Очередь'), { target: { value: 'overdue' } });
    await waitFor(() => {
      expect(listInboxMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ queue: 'overdue' }),
        expect.any(Object),
      );
    });

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'Ив' } });
    await waitFor(() => {
      expect(listInboxMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ queue: 'overdue', q: 'Ив' }),
        expect.any(Object),
      );
    });

    fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'plumber' } });
    await waitFor(() => {
      expect(listInboxMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ queue: 'overdue', q: 'Ив', category: 'plumber' }),
        expect.any(Object),
      );
    });
  });

  test('supports internal notes and request quick actions', async () => {
    renderWithProviders(<StaffWorkspacePage />);
    await screen.findByText('Вызвали сантехника');

    fireEvent.change(screen.getByPlaceholderText(/комментарий видят/i), {
      target: { value: 'Передали инженеру' },
    });
    fireEvent.click(screen.getByRole('button', { name: /добавить заметку/i }));
    await waitFor(() => {
      expect(createInternalCommentMock).toHaveBeenCalledWith(
        'req-1',
        { body: 'Передали инженеру' },
      );
    });

    fireEvent.change(screen.getByPlaceholderText(/сообщение увидит/i), {
      target: { value: 'Мастер едет' },
    });
    fireEvent.click(screen.getByRole('button', { name: /отправить резиденту/i }));
    await waitFor(() => {
      expect(createServiceRequestUpdateMock).toHaveBeenCalledWith(
        'req-1',
        { body: 'Мастер едет' },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /взять в работу/i }));
    await waitFor(() => {
      expect(assignRequestMock).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ assigneeUid: 'staff-1', assigneeRole: 'concierge' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /^первый ответ$/i }));
    await waitFor(() => {
      expect(markFirstResponseMock).toHaveBeenCalledWith('req-1');
    });

    fireEvent.click(screen.getByRole('button', { name: /^принять$/i }));
    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ status: 'accepted', expectedCurrentStatus: 'pending' }),
      );
    });
  });

  test('supports canonical service request operations', async () => {
    renderWithProviders(<StaffWorkspacePage />);
    await screen.findByText('Canonical requests');

    expect(listServiceRequestsMock).toHaveBeenCalledWith(
      { limit: 10, page: 1 },
      expect.any(Object),
    );
    expect(emergencyQueueMock).toHaveBeenCalledWith(
      { propertyId: 'prop-1', status: undefined, severity: undefined, limit: 10 },
      expect.any(Object),
    );

    fireEvent.change(screen.getByLabelText('Request ID'), { target: { value: 'req-1' } });
    fireEvent.change(screen.getByLabelText('Category code'), { target: { value: 'plumber' } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Plumber updated' } });
    fireEvent.change(screen.getByLabelText('Target ID'), { target: { value: 'unit-1' } });
    fireEvent.change(screen.getByLabelText('Assignee UID'), { target: { value: 'staff-2' } });
    fireEvent.change(screen.getByLabelText('Attachment URL'), { target: { value: '/uploads/evidence.jpg' } });
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Операционный комментарий' } });

    fireEvent.click(screen.getByRole('button', { name: 'Создать canonical request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить canonical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Первый ответ canonical' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upsert category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить attachment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Оценить request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить request' }));

    await waitFor(() => {
      expect(createServiceRequestMock).toHaveBeenCalledWith({
        type: 'service',
        category: 'plumber',
        status: 'new',
        comment: 'Операционный комментарий',
        targetType: 'unit',
        targetId: 'unit-1',
      });
      expect(updateServiceRequestMock).toHaveBeenCalledWith('req-1', {
        status: 'in_progress',
        expectedCurrentStatus: undefined,
        historyLabel: 'Статус изменён: Выполняется',
        comment: 'Операционный комментарий',
      });
      expect(assignServiceRequestMock).toHaveBeenCalledWith('req-1', {
        assigneeUid: 'staff-2',
        assigneeRole: 'concierge',
        assigneeName: 'Мария Консьерж',
        expectedCurrentStatus: undefined,
      });
      expect(markServiceRequestFirstResponseMock).toHaveBeenCalledWith('req-1');
      expect(upsertServiceRequestCategoryMock).toHaveBeenCalledWith('plumber', {
        propertyId: 'prop-1',
        name: 'Plumber updated',
        domain: 'service',
        targetScope: 'unit',
        priority: 'normal',
        slaProfile: 'standard',
        firstResponseMinutes: 60,
        resolutionMinutes: 240,
        isEmergency: false,
        metadata: { source: 'staff_workspace_ui' },
      });
      expect(createServiceRequestAttachmentMock).toHaveBeenCalledWith('req-1', {
        fileUrl: '/uploads/evidence.jpg',
        fileKind: 'photo',
        visibility: 'resident',
        metadata: { source: 'staff_workspace_ui' },
      });
      expect(rateServiceRequestMock).toHaveBeenCalledWith('req-1', {
        rating: 5,
        comment: 'Операционный комментарий',
      });
      expect(deleteServiceRequestMock).toHaveBeenCalledWith('req-1');
    });

    fireEvent.change(screen.getByLabelText('Emergency status'), { target: { value: 'resolved' } });
    await waitFor(() => {
      expect(emergencyQueueMock).toHaveBeenLastCalledWith(
        { propertyId: 'prop-1', status: 'resolved', severity: undefined, limit: 10 },
        expect.any(Object),
      );
    });
  }, 10000);

  test('uses a backend-valid category fallback for canonical request creation', async () => {
    listCategoriesMock.mockResolvedValueOnce({ data: [] });

    renderWithProviders(<StaffWorkspacePage />);
    await screen.findByText('Canonical requests');

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Операционный комментарий' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать canonical request' }));

    await waitFor(() => {
      expect(createServiceRequestMock).toHaveBeenCalledWith(expect.objectContaining({
        category: 'plumber',
      }));
    });
  });

  test('refreshes both detail and canonical lifecycle panels', async () => {
    renderWithProviders(<StaffWorkspacePage />);
    await screen.findByText('Вызвали сантехника');

    getRequestDetailMock.mockClear();
    getServiceRequestByIdMock.mockClear();
    getRequestHistoryMock.mockClear();
    getRequestAttachmentsMock.mockClear();
    getRequestUpdatesMock.mockClear();

    const refreshButtons = screen.getAllByRole('button', { name: /^обновить$/i });
    fireEvent.click(refreshButtons[refreshButtons.length - 1]);

    await waitFor(() => {
      expect(getRequestDetailMock).toHaveBeenCalledTimes(1);
      expect(getServiceRequestByIdMock).toHaveBeenCalledTimes(1);
      expect(getRequestHistoryMock).toHaveBeenCalledTimes(1);
      expect(getRequestAttachmentsMock).toHaveBeenCalledTimes(1);
      expect(getRequestUpdatesMock).toHaveBeenCalledTimes(1);
    });
  });
});
