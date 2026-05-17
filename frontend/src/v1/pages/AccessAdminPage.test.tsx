import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AccessPolicyTemplate } from '../api/accessPolicies';
import type { AccessIncident, AccessOverride, AccessPoint, AccessPolicy, AccessZone, AdminPassListItem, UserMe, Vehicle } from '../api/types';
import { V1SessionProvider } from '../store';

const {
  listPassesMock,
  getPassMock,
  getQrMock,
  regenerateQrMock,
  getPinMock,
  regeneratePinMock,
  createPassMock,
  revokePassMock,
  blockPassMock,
  unblockPassMock,
} = vi.hoisted(() => ({
  listPassesMock: vi.fn(),
  getPassMock: vi.fn(),
  getQrMock: vi.fn(),
  regenerateQrMock: vi.fn(),
  getPinMock: vi.fn(),
  regeneratePinMock: vi.fn(),
  createPassMock: vi.fn(),
  revokePassMock: vi.fn(),
  blockPassMock: vi.fn(),
  unblockPassMock: vi.fn(),
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
const {
  listZonesMock,
  listPointsMock,
  createZoneMock,
  updateZoneMock,
  deactivateZoneMock,
  createPointMock,
  updatePointMock,
  deactivatePointMock,
} = vi.hoisted(() => ({
  listZonesMock: vi.fn(),
  listPointsMock: vi.fn(),
  createZoneMock: vi.fn(),
  updateZoneMock: vi.fn(),
  deactivateZoneMock: vi.fn(),
  createPointMock: vi.fn(),
  updatePointMock: vi.fn(),
  deactivatePointMock: vi.fn(),
}));
const {
  policyTemplatesMock,
  listPoliciesMock,
  getPolicyMock,
  createPolicyMock,
  updatePolicyMock,
  evaluatePolicyMock,
  deactivatePolicyMock,
} = vi.hoisted(() => ({
  policyTemplatesMock: vi.fn(),
  listPoliciesMock: vi.fn(),
  getPolicyMock: vi.fn(),
  createPolicyMock: vi.fn(),
  updatePolicyMock: vi.fn(),
  evaluatePolicyMock: vi.fn(),
  deactivatePolicyMock: vi.fn(),
}));
const {
  listVehiclesMock,
  getVehicleByPlateMock,
  getVehicleByIdMock,
  createVehicleMock,
  updateVehicleMock,
  whitelistVehicleMock,
  blacklistVehicleMock,
  clearVehicleFlagsMock,
  deleteVehicleMock,
} = vi.hoisted(() => ({
  listVehiclesMock: vi.fn(),
  getVehicleByPlateMock: vi.fn(),
  getVehicleByIdMock: vi.fn(),
  createVehicleMock: vi.fn(),
  updateVehicleMock: vi.fn(),
  whitelistVehicleMock: vi.fn(),
  blacklistVehicleMock: vi.fn(),
  clearVehicleFlagsMock: vi.fn(),
  deleteVehicleMock: vi.fn(),
}));

vi.mock('../api/passes', () => ({
  passesApi: {
    list: listPassesMock,
    getById: getPassMock,
    getQr: getQrMock,
    regenerateQr: regenerateQrMock,
    getPin: getPinMock,
    regeneratePin: regeneratePinMock,
    create: createPassMock,
    revoke: revokePassMock,
    block: blockPassMock,
    unblock: unblockPassMock,
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

vi.mock('../api/accessTopology', () => ({
  accessTopologyApi: {
    listZones: listZonesMock,
    listPoints: listPointsMock,
    createZone: createZoneMock,
    updateZone: updateZoneMock,
    deactivateZone: deactivateZoneMock,
    createPoint: createPointMock,
    updatePoint: updatePointMock,
    deactivatePoint: deactivatePointMock,
  },
}));

vi.mock('../api/accessPolicies', () => ({
  accessPoliciesApi: {
    templates: policyTemplatesMock,
    list: listPoliciesMock,
    getById: getPolicyMock,
    create: createPolicyMock,
    update: updatePolicyMock,
    evaluate: evaluatePolicyMock,
    deactivate: deactivatePolicyMock,
  },
}));

vi.mock('../api/vehicles', () => ({
  normalizePlate: (value: string) => value.toUpperCase().replace(/[^A-ZА-Я0-9]/g, ''),
  vehiclesApi: {
    list: listVehiclesMock,
    getByPlate: getVehicleByPlateMock,
    getById: getVehicleByIdMock,
    create: createVehicleMock,
    update: updateVehicleMock,
    whitelist: whitelistVehicleMock,
    blacklist: blacklistVehicleMock,
    clearFlags: clearVehicleFlagsMock,
    delete: deleteVehicleMock,
  },
}));

import { AccessAdminPage } from './AccessAdminPage';

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_PASS = '22222222-2222-4222-8222-222222222222';
const UUID_INCIDENT = '44444444-4444-4444-8444-444444444444';
const UUID_CREATED_INCIDENT = '44444444-4444-4444-8444-444444444445';
const UUID_OVERRIDE = '55555555-5555-4555-8555-555555555555';
const UUID_ZONE = '88888888-8888-4888-8888-888888888888';
const UUID_POINT = '99999999-9999-4999-8999-999999999999';
const UUID_POLICY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_VEHICLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function makeZone(overrides: Partial<AccessZone> = {}): AccessZone {
  return {
    id: UUID_ZONE,
    property_id: UUID_PROPERTY,
    building_id: null,
    name: 'Периметр',
    zone_type: 'perimeter',
    description: 'Внешний контур',
    is_active: true,
    sort_order: 10,
    metadata: null,
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

function makePoint(overrides: Partial<AccessPoint> = {}): AccessPoint {
  return {
    id: UUID_POINT,
    property_id: UUID_PROPERTY,
    zone_id: UUID_ZONE,
    name: 'КПП 1',
    point_type: 'barrier',
    provider: 'Bolid',
    provider_external_id: 'door-1',
    description: 'Въездной шлагбаум',
    is_active: true,
    sort_order: 10,
    metadata: null,
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<AccessPolicy> = {}): AccessPolicy {
  return {
    id: UUID_POLICY,
    property_id: UUID_PROPERTY,
    name: 'Гостевой въезд',
    subject_type: 'guest',
    subject_role: null,
    zone_id: UUID_ZONE,
    point_id: UUID_POINT,
    access_method: 'qr',
    approval_mode: 'required',
    effect: 'needs_approval',
    priority: 60,
    schedule_json: null,
    duration_minutes: 120,
    is_recurring: false,
    is_active: true,
    created_by: null,
    metadata: null,
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

function makePolicyTemplate(overrides: Partial<AccessPolicyTemplate> = {}): AccessPolicyTemplate {
  return {
    key: 'guest_qr_entry',
    name: 'Гостевой QR',
    subject_type: 'guest',
    zone_id: UUID_ZONE,
    point_id: UUID_POINT,
    access_method: 'qr',
    approval_mode: 'required',
    effect: 'needs_approval',
    priority: 70,
    duration_minutes: 90,
    is_recurring: false,
    metadata: { source: 'template' },
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: UUID_VEHICLE,
    property_id: UUID_PROPERTY,
    owner_type: 'resident',
    owner_resident_id: 'resident-1',
    owner_staff_id: null,
    owner_contractor_user_id: null,
    plate_number: 'A001AA77',
    vehicle_type: 'car',
    color: 'Черный',
    brand: 'BMW',
    model: 'X5',
    is_whitelisted: false,
    is_blacklisted: false,
    notes: 'Постоянный резидент',
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: null,
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
    expect(within(passRow as HTMLElement).getAllByText('QR').length).toBeGreaterThan(0);
    expect(within(passRow as HTMLElement).getAllByText('PIN').length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByText('Загрузить ещё'));

    expect(await screen.findByText('Борис Курьер')).toBeInTheDocument();
    expect(listPassesMock).toHaveBeenLastCalledWith({
      property_id: UUID_PROPERTY,
      status: 'active',
      pass_type: undefined,
      q: undefined,
      limit: 25,
      offset: 25,
    });
    expect(screen.queryByText('Загрузить ещё')).not.toBeInTheDocument();
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

  test('creates passes and manages detail, credentials and unblock payloads', async () => {
    const blockedPass = makePass({ status: 'blocked' });
    const createdPassId = '22222222-2222-4222-8222-222222222299';
    listPassesMock.mockResolvedValue({
      passes: [blockedPass],
      page: { limit: 25, offset: 0, hasMore: false },
    });
    createPassMock.mockResolvedValue({ pass: makePass({ id: createdPassId, pass_type: 'vehicle', subject_type: 'vehicle' }) });
    getPassMock.mockResolvedValue({
      pass: blockedPass,
      qr: {
        id: 'qr-1',
        token: 'qr-token-current',
        render_version: 1,
      },
    });
    getQrMock.mockResolvedValue({ qr: { id: 'qr-2', token: 'qr-token-load', render_version: 1 } });
    regenerateQrMock.mockResolvedValue({ qr: { id: 'qr-3', token: 'qr-token-new', render_version: 2 } });
    getPinMock.mockResolvedValue({
      pin: {
        id: 'pin-1',
        value: '123456',
        render_version: 1,
        public_display_allowed: true,
      },
    });
    regeneratePinMock.mockResolvedValue({
      pin: {
        id: 'pin-2',
        value: '654321',
        render_version: 2,
        public_display_allowed: true,
      },
    });
    unblockPassMock.mockResolvedValue({ pass: makePass({ status: 'active' }) });

    renderPage();

    expect(await screen.findByText('Анна Гость')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Тип пропуска'), { target: { value: 'vehicle' } });
    fireEvent.change(screen.getByLabelText('Субъект'), { target: { value: 'vehicle' } });
    fireEvent.change(screen.getByLabelText('Vehicle ID'), { target: { value: 'vehicle-1' } });
    fireEvent.change(screen.getByLabelText('Zone ID'), { target: { value: 'zone-1' } });
    fireEvent.change(screen.getByLabelText('Point ID'), { target: { value: 'point-1' } });
    fireEvent.change(screen.getByLabelText('Действует с'), { target: { value: '2026-05-17T09:00:00.000Z' } });
    fireEvent.change(screen.getByLabelText('Действует до'), { target: { value: '2026-05-17T18:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать пропуск' }));

    await waitFor(() => {
      expect(createPassMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        pass_type: 'vehicle',
        subject_type: 'vehicle',
        subject_resident_id: null,
        subject_staff_id: null,
        subject_contractor_user_id: null,
        subject_vehicle_id: 'vehicle-1',
        zone_id: 'zone-1',
        point_id: 'point-1',
        valid_from: '2026-05-17T09:00:00.000Z',
        valid_until: '2026-05-17T18:00:00.000Z',
        access_request_id: null,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Деталь' }));
    await waitFor(() => expect(getPassMock).toHaveBeenCalledWith(UUID_PASS));
    expect(await screen.findByText(/qr-token-current/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    await waitFor(() => expect(getQrMock).toHaveBeenCalledWith(UUID_PASS));

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить QR' }));
    await waitFor(() => expect(regenerateQrMock).toHaveBeenCalledWith(UUID_PASS));
    expect(await screen.findByText(/qr-token-new/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PIN' }));
    await waitFor(() => expect(getPinMock).toHaveBeenCalledWith(UUID_PASS));
    expect(await screen.findByText(/123456/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить PIN' }));
    await waitFor(() => expect(regeneratePinMock).toHaveBeenCalledWith(UUID_PASS));
    expect(await screen.findByText(/654321/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Например, отмена визита'), {
      target: { value: 'Проверка завершена' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Разблокировать' }));
    await waitFor(() => {
      expect(unblockPassMock).toHaveBeenCalledWith(UUID_PASS, { reason: 'Проверка завершена' });
    });
  });

  test('manages vehicle list, detail and mutation payloads through v1 client', async () => {
    const vehicle = makeVehicle();
    const listedVehicle = makeVehicle({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1', plate_number: 'B002BB77' });
    const createdVehicle = makeVehicle({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2',
      plate_number: 'C003CC77',
      owner_resident_id: 'resident-2',
      brand: 'Audi',
      model: 'Q7',
      color: 'Белый',
      notes: 'Резидентский автомобиль',
    });
    const updatedVehicle = makeVehicle({ id: UUID_VEHICLE, brand: 'Audi', model: 'Q7', color: 'Белый' });
    listPassesMock.mockResolvedValue({ passes: [], page: { limit: 25, offset: 0, hasMore: false } });
    getVehicleByPlateMock.mockResolvedValue({ vehicle });
    listVehiclesMock.mockResolvedValue({ vehicles: [listedVehicle], page: { limit: 10, offset: 0, hasMore: false } });
    getVehicleByIdMock.mockResolvedValue({ vehicle });
    createVehicleMock.mockResolvedValue({ vehicle: createdVehicle });
    updateVehicleMock.mockResolvedValue({ vehicle: updatedVehicle });
    deleteVehicleMock.mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Авто' }));

    fireEvent.change(screen.getByLabelText('Гос. номер'), { target: { value: 'a 001 aa 77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    await waitFor(() => expect(getVehicleByPlateMock).toHaveBeenCalledWith('A001AA77'));
    expect(await screen.findByText(/BMW X5/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Vehicle ID'), { target: { value: UUID_VEHICLE } });
    fireEvent.change(screen.getByLabelText('Номер'), { target: { value: 'C003CC77' } });
    fireEvent.change(screen.getByLabelText('Resident owner ID'), { target: { value: 'resident-2' } });
    fireEvent.change(screen.getByLabelText('Staff owner ID'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Contractor owner ID'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Марка'), { target: { value: 'Audi' } });
    fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'Q7' } });
    fireEvent.change(screen.getByLabelText('Цвет'), { target: { value: 'Белый' } });
    fireEvent.change(screen.getByLabelText('Заметки'), { target: { value: 'Резидентский автомобиль' } });

    fireEvent.click(screen.getByRole('button', { name: 'Список авто' }));
    await waitFor(() => {
      expect(listVehiclesMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        plate: 'C003CC77',
        owner_type: 'resident',
        limit: 10,
      });
    });
    expect(await screen.findByText('B002BB77')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить авто' }));
    await waitFor(() => expect(getVehicleByIdMock).toHaveBeenCalledWith(UUID_VEHICLE));

    fireEvent.change(screen.getByLabelText('Номер'), { target: { value: 'C003CC77' } });
    fireEvent.change(screen.getByLabelText('Resident owner ID'), { target: { value: 'resident-2' } });
    fireEvent.change(screen.getByLabelText('Марка'), { target: { value: 'Audi' } });
    fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'Q7' } });
    fireEvent.change(screen.getByLabelText('Цвет'), { target: { value: 'Белый' } });
    fireEvent.change(screen.getByLabelText('Заметки'), { target: { value: 'Резидентский автомобиль' } });

    fireEvent.click(screen.getByRole('button', { name: 'Создать авто' }));
    await waitFor(() => {
      expect(createVehicleMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        plate_number: 'C003CC77',
        owner_type: 'resident',
        owner_resident_id: 'resident-2',
        owner_staff_id: null,
        owner_contractor_user_id: null,
        vehicle_type: 'car',
        brand: 'Audi',
        model: 'Q7',
        color: 'Белый',
        notes: 'Резидентский автомобиль',
      });
    });

    fireEvent.change(screen.getByLabelText('Vehicle ID'), { target: { value: UUID_VEHICLE } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить авто' }));
    await waitFor(() => {
      expect(updateVehicleMock).toHaveBeenCalledWith(UUID_VEHICLE, {
        vehicle_type: 'car',
        brand: 'Audi',
        model: 'Q7',
        color: 'Белый',
        notes: 'Резидентский автомобиль',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Удалить авто' }));
    await waitFor(() => expect(deleteVehicleMock).toHaveBeenCalledWith(UUID_VEHICLE));
  });
});

describe('AccessAdminPage topology and policy administration', () => {
  test('edits and deactivates topology zones and points through v1 clients', async () => {
    const zone = makeZone();
    const point = makePoint();
    listPassesMock.mockResolvedValue({ passes: [], page: { limit: 25, offset: 0, hasMore: false } });
    listZonesMock.mockResolvedValue({ zones: [zone] });
    listPointsMock.mockResolvedValue({ points: [point] });
    updateZoneMock.mockResolvedValue({ zone: makeZone({ name: 'Периметр 2' }) });
    deactivateZoneMock.mockResolvedValue(undefined);
    updatePointMock.mockResolvedValue({ point: makePoint({ name: 'КПП Восток' }) });
    deactivatePointMock.mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'КПП и зоны' }));

    expect(await screen.findByText('Периметр')).toBeInTheDocument();
    expect(listZonesMock).toHaveBeenCalledWith({ property_id: UUID_PROPERTY, is_active: true, limit: 100 });
    expect(listPointsMock).toHaveBeenCalledWith({ property_id: UUID_PROPERTY, is_active: true, limit: 200 });

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать зону' }));
    const zoneForm = screen.getByText('Редактирование зоны доступа').closest('section') as HTMLElement;
    fireEvent.change(within(zoneForm).getByLabelText('Название'), { target: { value: 'Периметр 2' } });
    fireEvent.click(within(zoneForm).getByRole('button', { name: 'Обновить зону' }));

    await waitFor(() => {
      expect(updateZoneMock).toHaveBeenCalledWith(UUID_ZONE, {
        name: 'Периметр 2',
        zone_type: 'perimeter',
        description: 'Внешний контур',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Отключить зону' }));
    await waitFor(() => expect(deactivateZoneMock).toHaveBeenCalledWith(UUID_ZONE));

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать точку' }));
    const pointForm = screen.getByText('Редактирование точки доступа').closest('section') as HTMLElement;
    fireEvent.change(within(pointForm).getByLabelText('Название'), { target: { value: 'КПП Восток' } });
    fireEvent.change(within(pointForm).getByLabelText('Внешний ID'), { target: { value: 'east-gate' } });
    fireEvent.click(within(pointForm).getByRole('button', { name: 'Обновить точку' }));

    await waitFor(() => {
      expect(updatePointMock).toHaveBeenCalledWith(UUID_POINT, {
        zone_id: UUID_ZONE,
        name: 'КПП Восток',
        point_type: 'barrier',
        provider: 'Bolid',
        provider_external_id: 'east-gate',
        description: 'Въездной шлагбаум',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Отключить точку' }));
    await waitFor(() => expect(deactivatePointMock).toHaveBeenCalledWith(UUID_POINT));
  });

  test('applies templates, loads detail, updates and evaluates access policies', async () => {
    const zone = makeZone();
    const point = makePoint();
    const policy = makePolicy();
    const template = makePolicyTemplate();
    listPassesMock.mockResolvedValue({ passes: [], page: { limit: 25, offset: 0, hasMore: false } });
    listZonesMock.mockResolvedValue({ zones: [zone] });
    listPointsMock.mockResolvedValue({ points: [point] });
    policyTemplatesMock.mockResolvedValue({ templates: [template] });
    listPoliciesMock.mockResolvedValue({ policies: [policy] });
    createPolicyMock.mockResolvedValue({ policy: makePolicy({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' }) });
    getPolicyMock.mockResolvedValue({ policy });
    updatePolicyMock.mockResolvedValue({ policy: makePolicy({ name: 'Гостевой въезд обновлен' }) });
    evaluatePolicyMock.mockResolvedValue({
      decision: {
        allowed: false,
        decision: 'needs_approval',
        reason: 'Требуется согласование',
        matched_policy_id: UUID_POLICY,
        matched_policy_name: policy.name,
        trace: [{ policy_id: UUID_POLICY }],
      },
    });
    deactivatePolicyMock.mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Политики' }));

    expect(await screen.findByText('Гостевой QR')).toBeInTheDocument();
    expect(policyTemplatesMock).toHaveBeenCalledWith({ property_id: UUID_PROPERTY });
    fireEvent.click(screen.getByRole('button', { name: 'Применить шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать политику' }));

    await waitFor(() => {
      expect(createPolicyMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        name: 'Гостевой QR',
        subject_type: 'guest',
        access_method: 'qr',
        effect: 'needs_approval',
        approval_mode: 'required',
        priority: 70,
        zone_id: UUID_ZONE,
        point_id: UUID_POINT,
        duration_minutes: 90,
        is_recurring: false,
        metadata: { source: 'access_admin_ui' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать политику' }));
    await waitFor(() => expect(getPolicyMock).toHaveBeenCalledWith(UUID_POLICY));

    const policyForm = screen.getByText('Редактирование политики доступа').closest('section') as HTMLElement;
    fireEvent.change(within(policyForm).getByLabelText('Тип пропуска'), { target: { value: 'guest' } });
    fireEvent.click(within(policyForm).getByRole('button', { name: 'Обновить политику' }));

    await waitFor(() => {
      expect(updatePolicyMock).toHaveBeenCalledWith(UUID_POLICY, {
        name: 'Гостевой въезд',
        subject_type: 'guest',
        access_method: 'qr',
        effect: 'needs_approval',
        approval_mode: 'required',
        priority: 60,
        zone_id: UUID_ZONE,
        point_id: UUID_POINT,
        duration_minutes: 120,
        is_recurring: false,
        metadata: { source: 'access_admin_ui' },
      });
    });

    fireEvent.click(within(policyForm).getByRole('button', { name: 'Оценить политику' }));
    await waitFor(() => {
      expect(evaluatePolicyMock).toHaveBeenCalledWith({
        property_id: UUID_PROPERTY,
        subject_type: 'guest',
        pass_type: 'guest',
        access_method: 'qr',
        zone_id: UUID_ZONE,
        point_id: UUID_POINT,
      });
    });
    expect(await screen.findByText(/Требуется согласование/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отключить политику' }));
    await waitFor(() => expect(deactivatePolicyMock).toHaveBeenCalledWith(UUID_POLICY));
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
