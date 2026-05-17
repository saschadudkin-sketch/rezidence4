import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AccessIncident, AccessOverride, AdminPassListItem, UserMe } from '../api/types';
import { V1SessionProvider } from '../store';

const { listPassesMock, revokePassMock, blockPassMock } = vi.hoisted(() => ({
  listPassesMock: vi.fn(),
  revokePassMock: vi.fn(),
  blockPassMock: vi.fn(),
}));
const {
  listIncidentsMock,
  getIncidentMock,
  listOverridesMock,
  getOverrideMock,
  createOverrideMock,
  createIncidentMock,
  patchIncidentMock,
  assignIncidentMock,
  resolveIncidentMock,
  dismissIncidentMock,
  reopenIncidentMock,
  updateIncidentStatusMock,
  listVideoEvidenceMock,
  createVideoEvidenceMock,
  fetchVideoEvidenceMock,
} = vi.hoisted(() => ({
  listIncidentsMock: vi.fn(),
  getIncidentMock: vi.fn(),
  listOverridesMock: vi.fn(),
  getOverrideMock: vi.fn(),
  createOverrideMock: vi.fn(),
  createIncidentMock: vi.fn(),
  patchIncidentMock: vi.fn(),
  assignIncidentMock: vi.fn(),
  resolveIncidentMock: vi.fn(),
  dismissIncidentMock: vi.fn(),
  reopenIncidentMock: vi.fn(),
  updateIncidentStatusMock: vi.fn(),
  listVideoEvidenceMock: vi.fn(),
  createVideoEvidenceMock: vi.fn(),
  fetchVideoEvidenceMock: vi.fn(),
}));

vi.mock('../api/passes', () => ({
  passesApi: {
    list: listPassesMock,
    revoke: revokePassMock,
    block: blockPassMock,
  },
}));

vi.mock('../api/accessIncidents', () => ({
  accessIncidentsApi: {
    list: listIncidentsMock,
    getById: getIncidentMock,
    listOverrides: listOverridesMock,
    getOverride: getOverrideMock,
    createOverride: createOverrideMock,
    create: createIncidentMock,
    patch: patchIncidentMock,
    assign: assignIncidentMock,
    resolve: resolveIncidentMock,
    dismiss: dismissIncidentMock,
    reopen: reopenIncidentMock,
    updateStatus: updateIncidentStatusMock,
    listVideoEvidence: listVideoEvidenceMock,
    createVideoEvidence: createVideoEvidenceMock,
    fetchVideoEvidence: fetchVideoEvidenceMock,
  },
}));

import { AccessAdminPage } from './AccessAdminPage';

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_PASS = '22222222-2222-4222-8222-222222222222';
const UUID_INCIDENT = '44444444-4444-4444-8444-444444444444';
const UUID_CREATED_INCIDENT = '44444444-4444-4444-8444-444444444445';
const UUID_OVERRIDE = '55555555-5555-4555-8555-555555555555';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: '00000000-0000-0000-0000-0000000000aa',
    role: 'admin',
    name: 'Тестовый Админ',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'zamoskvorechye',
    property_id: UUID_PROPERTY,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function makePass(overrides: Partial<AdminPassListItem> = {}): AdminPassListItem {
  return {
    id: UUID_PASS,
    property_id: UUID_PROPERTY,
    access_request_id: null,
    pass_type: 'guest',
    subject_type: 'guest',
    subject_resident_id: null,
    subject_staff_id: null,
    subject_contractor_user_id: null,
    subject_vehicle_id: null,
    zone_id: null,
    point_id: null,
    policy_id: null,
    valid_from: '2026-05-10T10:00:00.000Z',
    valid_until: '2099-05-20T12:00:00.000Z',
    status: 'active',
    approved_by_staff_id: null,
    revoked_at: null,
    revoked_by_staff_id: null,
    revoked_reason: null,
    created_at: '2026-05-16T10:00:00.000Z',
    visitor_name: 'Анна Гость',
    resident_name: 'Иван Петров',
    unit_number: '125',
    vehicle_plate: 'A001AA77',
    access_point_name: 'КПП 1',
    access_zone_name: 'Периметр',
    credential_types: ['qr', 'pin'],
    guest_instructions: 'Показать QR',
    guard_notes: 'Проверить документы',
    ...overrides,
  };
}

function makeIncident(overrides: Partial<AccessIncident> = {}): AccessIncident {
  return {
    id: UUID_INCIDENT,
    property_id: UUID_PROPERTY,
    related_pass_id: UUID_PASS,
    related_visit_log_id: '66666666-6666-4666-8666-666666666666',
    related_vehicle_id: null,
    incident_type: 'manual_override',
    severity: 'high',
    status: 'open',
    title: 'Ручной пропуск без политики',
    description: 'Охрана открыла шлагбаум вручную.',
    created_by_staff_id: null,
    assigned_to_staff_id: null,
    resolved_at: null,
    created_at: '2026-05-16T10:00:00.000Z',
    ...overrides,
  };
}

function makeOverride(overrides: Partial<AccessOverride> = {}): AccessOverride {
  return {
    id: UUID_OVERRIDE,
    property_id: UUID_PROPERTY,
    incident_id: UUID_INCIDENT,
    pass_id: UUID_PASS,
    performed_by_staff_id: '77777777-7777-4777-8777-777777777777',
    override_type: 'manual_admit',
    reason: 'Разрешено администратором',
    created_at: '2026-05-16T10:05:00.000Z',
    ...overrides,
  };
}

function renderPage(user = makeUser()) {
  return render(
    <MemoryRouter>
      <V1SessionProvider initialUser={user}>
        <AccessAdminPage />
      </V1SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('AccessAdminPage pass management', () => {
  test('loads active pass read model by default and exposes staff-only notes', async () => {
    listPassesMock.mockResolvedValue({ passes: [makePass()], page: { limit: 100, offset: 0, hasMore: false } });

    renderPage();

    expect(await screen.findByText('Анна Гость')).toBeInTheDocument();
    const passRow = screen.getByText('Анна Гость').closest('li');
    expect(passRow).not.toBeNull();
    expect(within(passRow as HTMLElement).getByText('Активен')).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText('Гость')).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText(/юнит 125/)).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText(/точка КПП 1/)).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText('QR')).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText('PIN')).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText(/Показать QR/)).toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByText(/Проверить документы/)).toBeInTheDocument();
    expect(listPassesMock).toHaveBeenCalledWith({
      property_id: UUID_PROPERTY,
      status: 'active',
      pass_type: undefined,
      q: undefined,
      limit: 25,
      offset: 0,
    });
  });

  test('shows future active passes as scheduled, not currently active', async () => {
    listPassesMock.mockResolvedValue({
      passes: [makePass({ valid_from: '2099-05-20T10:00:00.000Z' })],
      page: { limit: 100, offset: 0, hasMore: false },
    });

    renderPage();

    const title = await screen.findByText('Анна Гость');
    const passRow = title.closest('li');
    expect(passRow).not.toBeNull();
    expect(within(passRow as HTMLElement).getByText(/Запланирован с/)).toBeInTheDocument();
    expect(within(passRow as HTMLElement).queryByText('Активен')).not.toBeInTheDocument();
    expect(within(passRow as HTMLElement).getByRole('button', { name: 'Отозвать' })).toBeInTheDocument();
  });

  test('loads next page when backend reports more passes', async () => {
    const secondPassId = '33333333-3333-4333-8333-333333333333';
    const firstPage = Array.from({ length: 25 }, (_, index) => makePass({
      id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
      visitor_name: index === 0 ? 'Анна Гость' : `Гость ${index}`,
    }));
    listPassesMock
      .mockResolvedValueOnce({
        passes: firstPage,
        page: { limit: 25, offset: 0, hasMore: true },
      })
      .mockResolvedValueOnce({
        passes: [makePass({ id: secondPassId, visitor_name: 'Борис Курьер', pass_type: 'courier' })],
        page: { limit: 25, offset: 25, hasMore: false },
      });

    renderPage();

    expect(await screen.findByText('Анна Гость')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));

    expect(await screen.findByText('Борис Курьер')).toBeInTheDocument();
    expect(listPassesMock).toHaveBeenLastCalledWith({
      property_id: UUID_PROPERTY,
      status: 'active',
      pass_type: undefined,
      q: undefined,
      limit: 25,
      offset: 25,
    });
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument();
  });

  test('requires revoke reason and refreshes after successful revoke', async () => {
    listPassesMock
      .mockResolvedValueOnce({ passes: [makePass()], page: { limit: 100, offset: 0, hasMore: false } })
      .mockResolvedValueOnce({ passes: [], page: { limit: 100, offset: 0, hasMore: false } });
    revokePassMock.mockResolvedValue({ pass: makePass({ status: 'revoked' }) });

    renderPage();

    expect(await screen.findByText('Анна Гость')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать' }));
    expect(await screen.findByText('Укажите причину отзыва пропуска')).toBeInTheDocument();
    expect(revokePassMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Например, отмена визита'), {
      target: { value: 'Визит отменён' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать' }));

    await waitFor(() => expect(revokePassMock).toHaveBeenCalledWith(UUID_PASS, 'Визит отменён'));
    await waitFor(() => expect(listPassesMock).toHaveBeenCalledTimes(2));
  });
});

describe('AccessAdminPage incident workflow', () => {
  test('opens incident detail and sends management payloads', async () => {
    const incident = makeIncident();
    const createdIncident = makeIncident({ id: UUID_CREATED_INCIDENT, title: 'Новый инцидент' });
    const override = makeOverride();
    listPassesMock.mockResolvedValue({ passes: [], page: { limit: 25, offset: 0, hasMore: false } });
    listIncidentsMock.mockResolvedValue({ incidents: [incident, createdIncident], page: { limit: 100, offset: 0, hasMore: false } });
    getIncidentMock.mockResolvedValue({ incident });
    listOverridesMock.mockResolvedValue({ overrides: [override], page: { limit: 20, offset: 0, hasMore: false } });
    listVideoEvidenceMock.mockResolvedValue({ evidence: [{ id: 'video-1', evidence_url: 'https://video.test/clip.mp4' }] });
    createIncidentMock.mockResolvedValue({ incident: createdIncident });
    patchIncidentMock.mockResolvedValue({ incident: makeIncident({ title: 'Обновленный инцидент' }) });
    assignIncidentMock.mockResolvedValue({ incident: makeIncident({ assigned_to_staff_id: 'staff-1' }) });
    updateIncidentStatusMock.mockResolvedValue({ incident: makeIncident({ status: 'investigating' }) });
    resolveIncidentMock.mockResolvedValue({ incident: makeIncident({ status: 'resolved' }) });
    dismissIncidentMock.mockResolvedValue({ incident: makeIncident({ status: 'dismissed' }) });
    reopenIncidentMock.mockResolvedValue({ incident: makeIncident({ status: 'open' }) });
    createOverrideMock.mockResolvedValue({ override });
    getOverrideMock.mockResolvedValue({ override });
    createVideoEvidenceMock.mockResolvedValue({ evidence: { id: 'video-2' } });
    fetchVideoEvidenceMock.mockResolvedValue({ evidence: { id: 'video-3' } });

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Инциденты' }));

    expect(await screen.findByText('Ручной пропуск без политики')).toBeInTheDocument();
    expect(listIncidentsMock).toHaveBeenCalledWith({
      property_id: UUID_PROPERTY,
      status: undefined,
      limit: 100,
    });
    await waitFor(() => {
      expect(getIncidentMock).toHaveBeenCalledWith(UUID_INCIDENT);
      expect(listOverridesMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        incident_id: UUID_INCIDENT,
        limit: 20,
      });
      expect(listVideoEvidenceMock).toHaveBeenCalledWith(UUID_INCIDENT);
    });

    fireEvent.change(screen.getByPlaceholderText('Ручной инцидент'), {
      target: { value: 'Новый инцидент' },
    });
    fireEvent.change(screen.getByPlaceholderText('Контекст для разбора'), {
      target: { value: 'Создан из UI' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать инцидент' }));
    await waitFor(() => {
      expect(createIncidentMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        incident_type: 'manual_override',
        severity: 'medium',
        title: 'Новый инцидент',
        description: 'Создан из UI',
      });
    });

    fireEvent.change(screen.getByDisplayValue('Ручной пропуск без политики'), {
      target: { value: 'Обновленный инцидент' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить карточку' }));
    await waitFor(() => {
      expect(patchIncidentMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        title: 'Обновленный инцидент',
        severity: 'high',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('staff-uuid'), {
      target: { value: 'staff-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    await waitFor(() => {
      expect(assignIncidentMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        assigned_to_staff_id: 'staff-1',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('Основание решения'), {
      target: { value: 'Разбор начат' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить статус' }));
    await waitFor(() => {
      expect(updateIncidentStatusMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        status: 'investigating',
        reason: 'Разбор начат',
        assigned_to_staff_id: 'staff-1',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(resolveIncidentMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, { reason: 'Разбор начат' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => {
      expect(dismissIncidentMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, { reason: 'Разбор начат' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Переоткрыть' }));
    await waitFor(() => {
      expect(reopenIncidentMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        reason: 'Разбор начат',
        assigned_to_staff_id: 'staff-1',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('Решение администратора'), {
      target: { value: 'Разрешено на смену' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать override' }));
    await waitFor(() => {
      expect(createOverrideMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        incident_id: UUID_CREATED_INCIDENT,
        pass_id: UUID_PASS,
        override_type: 'manual_admit',
        reason: 'Разрешено на смену',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await waitFor(() => {
      expect(getOverrideMock).toHaveBeenCalledWith(UUID_OVERRIDE);
    });
    expect(await screen.findByText(/manual_admit: Разрешено администратором/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('https://provider/clip.mp4'), {
      target: { value: 'https://video.test/manual.mp4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить видео' }));
    await waitFor(() => {
      expect(createVideoEvidenceMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        property_id: UUID_PROPERTY,
        evidence_url: 'https://video.test/manual.mp4',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('camera-uuid'), {
      target: { value: 'camera-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Запросить у провайдера' }));
    await waitFor(() => {
      expect(fetchVideoEvidenceMock).toHaveBeenCalledWith(UUID_CREATED_INCIDENT, {
        property_id: UUID_PROPERTY,
        camera_device_id: 'camera-1',
      });
    });
  });
});
