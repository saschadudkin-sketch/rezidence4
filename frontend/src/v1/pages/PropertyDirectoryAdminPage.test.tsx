import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import type {
  Building,
  ContractorCompany,
  ContractorUser,
  Entrance,
  RoleScopeMembership,
  StaffUser,
  Unit,
  UserMe,
} from '../api/types';

const {
  listBuildingsMock,
  listEntrancesMock,
  listUnitsMock,
  listResidentsMock,
  listStaffMock,
  listCompaniesMock,
  listContractorUsersMock,
  listMembershipsMock,
  createBuildingMock,
  createEntranceMock,
  getUnitByIdMock,
  createUnitMock,
  updateUnitMock,
  deactivateUnitMock,
  importUnitsMock,
  createResidentMock,
  updateResidentMock,
  deactivateResidentMock,
  transferResidentOwnershipMock,
  residentConsentMock,
  getStaffByIdMock,
  createStaffMock,
  updateStaffMock,
  deactivateStaffMock,
  staffImportTemplateUrlMock,
  previewStaffImportMock,
  applyStaffImportMock,
  getCompanyByIdMock,
  createCompanyMock,
  updateCompanyMock,
  createContractorUserMock,
  updateContractorUserMock,
  deactivateContractorUserMock,
  contractorImportTemplateUrlMock,
  previewContractorImportMock,
  applyContractorImportMock,
  listMineMembershipsMock,
  createMembershipMock,
  revokeMembershipMock,
} = vi.hoisted(() => ({
  listBuildingsMock: vi.fn(),
  listEntrancesMock: vi.fn(),
  listUnitsMock: vi.fn(),
  listResidentsMock: vi.fn(),
  listStaffMock: vi.fn(),
  listCompaniesMock: vi.fn(),
  listContractorUsersMock: vi.fn(),
  listMembershipsMock: vi.fn(),
  createBuildingMock: vi.fn(),
  createEntranceMock: vi.fn(),
  getUnitByIdMock: vi.fn(),
  createUnitMock: vi.fn(),
  updateUnitMock: vi.fn(),
  deactivateUnitMock: vi.fn(),
  importUnitsMock: vi.fn(),
  createResidentMock: vi.fn(),
  updateResidentMock: vi.fn(),
  deactivateResidentMock: vi.fn(),
  transferResidentOwnershipMock: vi.fn(),
  residentConsentMock: vi.fn(),
  getStaffByIdMock: vi.fn(),
  createStaffMock: vi.fn(),
  updateStaffMock: vi.fn(),
  deactivateStaffMock: vi.fn(),
  staffImportTemplateUrlMock: vi.fn(),
  previewStaffImportMock: vi.fn(),
  applyStaffImportMock: vi.fn(),
  getCompanyByIdMock: vi.fn(),
  createCompanyMock: vi.fn(),
  updateCompanyMock: vi.fn(),
  createContractorUserMock: vi.fn(),
  updateContractorUserMock: vi.fn(),
  deactivateContractorUserMock: vi.fn(),
  contractorImportTemplateUrlMock: vi.fn(),
  previewContractorImportMock: vi.fn(),
  applyContractorImportMock: vi.fn(),
  listMineMembershipsMock: vi.fn(),
  createMembershipMock: vi.fn(),
  revokeMembershipMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      units: {
        listBuildings: listBuildingsMock,
        createBuilding: createBuildingMock,
        listEntrances: listEntrancesMock,
        createEntrance: createEntranceMock,
        list: listUnitsMock,
        getById: getUnitByIdMock,
        create: createUnitMock,
        update: updateUnitMock,
        deactivate: deactivateUnitMock,
        importRows: importUnitsMock,
      },
      residents: {
        list: listResidentsMock,
        create: createResidentMock,
        update: updateResidentMock,
        deactivate: deactivateResidentMock,
        transferOwnership: transferResidentOwnershipMock,
        consent: residentConsentMock,
      },
      staff: {
        list: listStaffMock,
        getById: getStaffByIdMock,
        create: createStaffMock,
        update: updateStaffMock,
        deactivate: deactivateStaffMock,
        importTemplateUrl: staffImportTemplateUrlMock,
        previewImport: previewStaffImportMock,
        applyImport: applyStaffImportMock,
      },
      contractors: {
        listCompanies: listCompaniesMock,
        getCompanyById: getCompanyByIdMock,
        createCompany: createCompanyMock,
        updateCompany: updateCompanyMock,
        listUsers: listContractorUsersMock,
        createUser: createContractorUserMock,
        updateUser: updateContractorUserMock,
        deactivateUser: deactivateContractorUserMock,
        importTemplateUrl: contractorImportTemplateUrlMock,
        previewImport: previewContractorImportMock,
        applyImport: applyContractorImportMock,
      },
      memberships: {
        listMine: listMineMembershipsMock,
        list: listMembershipsMock,
        create: createMembershipMock,
        revoke: revokeMembershipMock,
      },
    },
    isV1ApiError: () => false,
  };
});

import { V1SessionProvider } from '../store';
import { PropertyDirectoryAdminPage } from './PropertyDirectoryAdminPage';

const PROPERTY_ID = '00000000-0000-0000-0000-000000000bbb';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: '00000000-0000-0000-0000-0000000000aa',
    role: 'admin',
    name: 'Админ',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'alpha',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function renderWithProviders(node: ReactElement, user: UserMe = makeUser()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
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

function setupDirectoryMocks() {
  const building: Building = {
    id: '00000000-0000-0000-0000-000000000101',
    property_id: PROPERTY_ID,
    code: 'A',
    name: 'Корпус A',
    sort_order: 1,
    created_at: '2026-05-01T00:00:00.000Z',
  };
  const entrance: Entrance = {
    id: '00000000-0000-0000-0000-000000000102',
    building_id: building.id,
    code: '1',
    name: 'Подъезд 1',
    sort_order: 1,
    created_at: '2026-05-01T00:00:00.000Z',
  };
  const unit: Unit = {
    id: '00000000-0000-0000-0000-000000000103',
    property_id: PROPERTY_ID,
    building_id: building.id,
    entrance_id: entrance.id,
    unit_number: '42',
    unit_type: 'apartment',
    floor: 8,
    is_active: true,
    created_at: '2026-05-01T00:00:00.000Z',
  };
  const staff: StaffUser = {
    id: '00000000-0000-0000-0000-000000000104',
    property_id: PROPERTY_ID,
    full_name: 'Мария Консьерж',
    phone: '+79990000001',
    email: 'maria@example.test',
    role: 'concierge',
    specialization: null,
    can_view_resident_phone: true,
    can_assign_requests: true,
    external_uid: null,
    is_active: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: null,
  };
  const company: ContractorCompany = {
    id: '00000000-0000-0000-0000-000000000105',
    property_id: PROPERTY_ID,
    name: 'Чистый Дом',
    status: 'active',
    contact_name: 'Пётр',
    contact_phone: '+79990000002',
    contact_email: 'clean@example.test',
    active_users_count: 1,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: null,
  };
  const contractorUser: ContractorUser = {
    id: '00000000-0000-0000-0000-000000000106',
    property_id: PROPERTY_ID,
    contractor_company_id: company.id,
    full_name: 'Пётр Подрядчик',
    phone: '+79990000002',
    email: 'petr@example.test',
    specialization: 'cleaning',
    access_expires_at: '2026-06-01T00:00:00.000Z',
    external_uid: null,
    is_active: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: null,
  };
  const membership: RoleScopeMembership = {
    id: '00000000-0000-0000-0000-000000000107',
    property_id: PROPERTY_ID,
    resident_id: null,
    staff_user_id: staff.id,
    contractor_user_id: null,
    external_subject_type: null,
    external_subject_id: null,
    management_company_id: null,
    role: 'concierge',
    scope_level: 'property',
    scope_id: null,
    status: 'active',
    starts_at: '2026-05-01T00:00:00.000Z',
    ends_at: null,
    created_by_staff_id: null,
    provisioned_from: 'staff_user',
    provisioned_at: '2026-05-01T00:00:00.000Z',
    revoked_at: null,
    revoked_reason: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: null,
  };

  listBuildingsMock.mockResolvedValue({ buildings: [building] });
  listEntrancesMock.mockResolvedValue({ entrances: [entrance] });
  listUnitsMock.mockResolvedValue({ units: [unit], page: { limit: 50, offset: 0, hasMore: false } });
  listResidentsMock.mockResolvedValue({
    residents: [{
      id: '00000000-0000-0000-0000-000000000108',
      property_id: PROPERTY_ID,
      unit_id: unit.id,
      full_name: 'Иван Житель',
      phone: '+79990000003',
      email: 'ivan@example.test',
      resident_type: 'owner',
      is_active: true,
      consent_given_at: null,
    }],
    page: { limit: 50, offset: 0, hasMore: false },
  });
  listStaffMock.mockResolvedValue({ staff: [staff], page: { limit: 50, offset: 0, hasMore: false } });
  listCompaniesMock.mockResolvedValue({ companies: [company], page: { limit: 50, offset: 0, hasMore: false } });
  listContractorUsersMock.mockResolvedValue({ users: [contractorUser], page: { limit: 50, offset: 0, hasMore: false } });
  listMembershipsMock.mockResolvedValue({ memberships: [membership], page: { limit: 50, offset: 0, hasMore: false } });

  createBuildingMock.mockResolvedValue({ building });
  createEntranceMock.mockResolvedValue({ entrance });
  getUnitByIdMock.mockResolvedValue({ unit, residents: [] });
  createUnitMock.mockResolvedValue({ unit });
  updateUnitMock.mockResolvedValue({ unit });
  deactivateUnitMock.mockResolvedValue(undefined);
  importUnitsMock.mockResolvedValue({
    property_type: 'residential_complex',
    imported: { buildings: 0, entrances: 0, units: 1, residents: 0, vehicles: 0 },
    skipped: { buildings: 0, entrances: 0, units: 0, residents: 0, vehicles: 0 },
    warnings: [],
    planned_access_points: [],
    access_topology: { zones: [], points: [] },
    readiness: { ready: true, homes_plots: 1, vehicles: null, planned_access_points: null },
    rows: [],
  });

  createResidentMock.mockResolvedValue({ resident: { id: 'resident-new' } });
  updateResidentMock.mockResolvedValue({ resident: { id: 'resident-1' } });
  deactivateResidentMock.mockResolvedValue({ offboarding: { summary: {} } });
  transferResidentOwnershipMock.mockResolvedValue({ ownership_transfer: { summary: {} } });
  residentConsentMock.mockResolvedValue({ resident: { id: 'resident-1' } });

  getStaffByIdMock.mockResolvedValue({ staff });
  createStaffMock.mockResolvedValue({ staff });
  updateStaffMock.mockResolvedValue({ staff });
  deactivateStaffMock.mockResolvedValue(undefined);
  staffImportTemplateUrlMock.mockReturnValue('/api/v1/staff/import/template');
  previewStaffImportMock.mockResolvedValue({ mode: 'preview', rows: [], checklist: {} });
  applyStaffImportMock.mockResolvedValue({ mode: 'apply', rows: [], checklist: {} });

  getCompanyByIdMock.mockResolvedValue({ company, users: [contractorUser] });
  createCompanyMock.mockResolvedValue({ company });
  updateCompanyMock.mockResolvedValue({ company });
  createContractorUserMock.mockResolvedValue({ user: contractorUser });
  updateContractorUserMock.mockResolvedValue({ user: contractorUser });
  deactivateContractorUserMock.mockResolvedValue(undefined);
  contractorImportTemplateUrlMock.mockReturnValue('/api/v1/contractors/import/template');
  previewContractorImportMock.mockResolvedValue({ mode: 'preview', rows: [], checklist: {} });
  applyContractorImportMock.mockResolvedValue({ mode: 'apply', rows: [], checklist: {} });

  listMineMembershipsMock.mockResolvedValue({ memberships: [membership] });
  createMembershipMock.mockResolvedValue({ membership });
  revokeMembershipMock.mockResolvedValue({ membership: { ...membership, status: 'revoked' } });
}

describe('PropertyDirectoryAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('property_id=null -> показывает предупреждение и не грузит справочники', () => {
    renderWithProviders(
      <PropertyDirectoryAdminPage />,
      makeUser({ property_id: null, property_slug: null }),
    );

    expect(screen.getByText(/не удалось определить объект/i)).toBeInTheDocument();
    expect(listBuildingsMock).not.toHaveBeenCalled();
    expect(listMembershipsMock).not.toHaveBeenCalled();
  });

  test('рисует read-only справочник по backend directory контрактам', async () => {
    setupDirectoryMocks();

    renderWithProviders(<PropertyDirectoryAdminPage />);

    expect(await screen.findByRole('heading', { name: /справочник объекта/i })).toBeInTheDocument();
    expect(await screen.findByText('Корпус A')).toBeInTheDocument();
    expect(screen.getByText('Квартира 42')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Жители' }));
    expect(await screen.findByText('Иван Житель')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    expect(await screen.findByText('Мария Консьерж')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Подрядчики' }));
    expect(await screen.findByText('Чистый Дом')).toBeInTheDocument();
    expect(screen.getByText('Пётр Подрядчик')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Членства' }));
    expect(await screen.findByText(/Сотрудник 00000000/)).toBeInTheDocument();

    await waitFor(() => {
      expect(listMembershipsMock).toHaveBeenCalledWith(
        { property_id: PROPERTY_ID, limit: 50 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test('отправляет mutation payloads для структуры, жителей, сотрудников, подрядчиков и членств', async () => {
    setupDirectoryMocks();

    renderWithProviders(<PropertyDirectoryAdminPage />);

    expect(await screen.findByRole('heading', { name: /справочник объекта/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Корпус B'), { target: { value: 'Корпус B' } });
    fireEvent.change(screen.getByPlaceholderText('B'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать корпус' }));
    await waitFor(() => {
      expect(createBuildingMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        name: 'Корпус B',
        code: 'B',
        sort_order: 1,
      });
    });

    fireEvent.change(screen.getAllByPlaceholderText('building-uuid')[0], { target: { value: 'building-1' } });
    fireEvent.change(screen.getByPlaceholderText('Подъезд 2'), { target: { value: 'Подъезд 2' } });
    fireEvent.change(screen.getByPlaceholderText('2'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать вход' }));
    await waitFor(() => {
      expect(createEntranceMock).toHaveBeenCalledWith({
        building_id: 'building-1',
        name: 'Подъезд 2',
        code: '2',
        sort_order: 1,
      });
    });

    fireEvent.change(screen.getByPlaceholderText('unit-uuid'), { target: { value: 'unit-1' } });
    fireEvent.change(screen.getAllByPlaceholderText('building-uuid')[1], { target: { value: 'building-1' } });
    fireEvent.change(screen.getByPlaceholderText('entrance-uuid'), { target: { value: 'entrance-1' } });
    fireEvent.change(screen.getByPlaceholderText('101'), { target: { value: '101' } });
    fireEvent.change(screen.getByPlaceholderText('8'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать юниты' }));
    await waitFor(() => {
      expect(getUnitByIdMock).toHaveBeenCalledWith('unit-1');
      expect(createUnitMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        building_id: 'building-1',
        entrance_id: 'entrance-1',
        unit_number: '101',
        unit_type: 'apartment',
        floor: 8,
      });
      expect(updateUnitMock).toHaveBeenCalledWith('unit-1', {
        unit_number: '101',
        unit_type: 'apartment',
        floor: 8,
      });
      expect(deactivateUnitMock).toHaveBeenCalledWith('unit-1');
      expect(importUnitsMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        property_type: 'residential_complex',
        rows: [{ building: 'A', entrance: '1', unit_number: '101' }],
      });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Жители' }));
    fireEvent.change(screen.getByPlaceholderText('resident-uuid'), { target: { value: 'resident-1' } });
    fireEvent.change(screen.getByPlaceholderText('unit-uuid'), { target: { value: 'unit-1' } });
    fireEvent.change(screen.getByPlaceholderText('Иван Житель'), { target: { value: 'Иван Житель' } });
    fireEvent.change(screen.getByPlaceholderText('+79990000003'), { target: { value: '+79990000003' } });
    fireEvent.change(screen.getByPlaceholderText('ivan@example.test'), { target: { value: 'ivan@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('new-owner-uuid'), { target: { value: 'resident-2' } });
    fireEvent.change(screen.getByPlaceholderText('Переезд'), { target: { value: 'Переезд' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать жителя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить жителя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать жителя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Передать ownership' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать consent' }));
    await waitFor(() => {
      expect(createResidentMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        unit_id: 'unit-1',
        full_name: 'Иван Житель',
        phone: '+79990000003',
        email: 'ivan@example.test',
        resident_type: 'owner',
      });
      expect(updateResidentMock).toHaveBeenCalledWith('resident-1', {
        unit_id: 'unit-1',
        full_name: 'Иван Житель',
        phone: '+79990000003',
        email: 'ivan@example.test',
        resident_type: 'owner',
      });
      expect(deactivateResidentMock).toHaveBeenCalledWith('resident-1', { reason: 'Переезд' });
      expect(transferResidentOwnershipMock).toHaveBeenCalledWith('resident-1', {
        to_resident_id: 'resident-2',
        reason: 'Переезд',
        cascade_notification_preferences: true,
      });
      expect(residentConsentMock).toHaveBeenCalledWith('resident-1', { consent_version: '2026-05-17' });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    fireEvent.change(screen.getByPlaceholderText('staff-uuid'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByPlaceholderText('Мария Консьерж'), { target: { value: 'Мария Консьерж' } });
    fireEvent.change(screen.getByPlaceholderText('maria@example.test'), { target: { value: 'maria@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('+79990000001'), { target: { value: '+79990000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить staff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать staff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить staff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать staff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview staff import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply staff import' }));
    await waitFor(() => {
      expect(staffImportTemplateUrlMock).toHaveBeenCalled();
      expect(getStaffByIdMock).toHaveBeenCalledWith('staff-1');
      expect(createStaffMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        full_name: 'Мария Консьерж',
        email: 'maria@example.test',
        phone: '+79990000001',
        role: 'concierge',
        specialization: null,
        can_view_resident_phone: true,
        can_assign_requests: true,
      });
      expect(updateStaffMock).toHaveBeenCalledWith('staff-1', {
        full_name: 'Мария Консьерж',
        phone: '+79990000001',
        role: 'concierge',
        specialization: null,
        can_view_resident_phone: true,
        can_assign_requests: true,
      });
      expect(deactivateStaffMock).toHaveBeenCalledWith('staff-1');
      expect(previewStaffImportMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        rows: [{ full_name: 'Мария Консьерж', email: 'maria@example.test', role: 'concierge' }],
      });
      expect(applyStaffImportMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        rows: [{ full_name: 'Мария Консьерж', email: 'maria@example.test', role: 'concierge' }],
      });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Подрядчики' }));
    fireEvent.change(screen.getByPlaceholderText('company-uuid'), { target: { value: 'company-1' } });
    fireEvent.change(screen.getByPlaceholderText('Чистый Дом'), { target: { value: 'Чистый Дом' } });
    fireEvent.change(screen.getByPlaceholderText('Петр'), { target: { value: 'Петр' } });
    fireEvent.change(screen.getAllByPlaceholderText('+79990000002')[0], { target: { value: '+79990000002' } });
    fireEvent.change(screen.getByPlaceholderText('clean@example.test'), { target: { value: 'clean@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить компанию' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать компанию' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить компанию' }));
    fireEvent.change(screen.getByPlaceholderText('contractor-user-uuid'), { target: { value: 'contractor-1' } });
    fireEvent.change(screen.getByPlaceholderText('Петр Подрядчик'), { target: { value: 'Петр Подрядчик' } });
    fireEvent.change(screen.getByPlaceholderText('petr@example.test'), { target: { value: 'petr@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('cleaning'), { target: { value: 'cleaning' } });
    fireEvent.change(screen.getByPlaceholderText('2026-06-01T00:00:00.000Z'), { target: { value: '2026-06-01T00:00:00.000Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать пользователя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить пользователя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать пользователя' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview contractor import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply contractor import' }));
    await waitFor(() => {
      expect(contractorImportTemplateUrlMock).toHaveBeenCalled();
      expect(getCompanyByIdMock).toHaveBeenCalledWith('company-1');
      expect(createCompanyMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        name: 'Чистый Дом',
        contact_name: 'Петр',
        contact_phone: '+79990000002',
        contact_email: 'clean@example.test',
      });
      expect(updateCompanyMock).toHaveBeenCalledWith('company-1', {
        name: 'Чистый Дом',
        status: 'active',
        contact_name: 'Петр',
        contact_phone: '+79990000002',
        contact_email: 'clean@example.test',
      });
      expect(createContractorUserMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        contractor_company_id: 'company-1',
        full_name: 'Петр Подрядчик',
        phone: null,
        email: 'petr@example.test',
        specialization: 'cleaning',
        access_expires_at: '2026-06-01T00:00:00.000Z',
      });
      expect(updateContractorUserMock).toHaveBeenCalledWith('contractor-1', {
        full_name: 'Петр Подрядчик',
        phone: null,
        email: 'petr@example.test',
        specialization: 'cleaning',
        access_expires_at: '2026-06-01T00:00:00.000Z',
      });
      expect(deactivateContractorUserMock).toHaveBeenCalledWith('contractor-1');
      expect(previewContractorImportMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        rows: [{ company_name: 'Чистый Дом', user_full_name: 'Петр Подрядчик' }],
      });
      expect(applyContractorImportMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        rows: [{ company_name: 'Чистый Дом', user_full_name: 'Петр Подрядчик' }],
      });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Членства' }));
    fireEvent.change(screen.getByPlaceholderText('membership-uuid'), { target: { value: 'membership-1' } });
    fireEvent.change(screen.getByPlaceholderText('subject-uuid'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByPlaceholderText('Роль больше не нужна'), { target: { value: 'Роль больше не нужна' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мои членства' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать членство' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать членство' }));
    await waitFor(() => {
      expect(listMineMembershipsMock).toHaveBeenCalled();
      expect(createMembershipMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        subject_type: 'staff',
        subject_id: 'staff-1',
        resident_id: null,
        staff_user_id: 'staff-1',
        contractor_user_id: null,
        external_subject_type: null,
        external_subject_id: null,
        role: 'concierge',
        scope_level: 'property',
        scope_id: null,
        provisioned_from: 'directory_admin_ui',
      });
      expect(revokeMembershipMock).toHaveBeenCalledWith('membership-1', { reason: 'Роль больше не нужна' });
    });
  }, 10000);

  test('догружает paged списки и не показывает незагруженные входы как ноль', async () => {
    const buildings = Array.from({ length: 13 }, (_, index): Building => ({
      id: `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`,
      property_id: PROPERTY_ID,
      code: String(index + 1),
      name: `Корпус ${index + 1}`,
      sort_order: index + 1,
      created_at: '2026-05-01T00:00:00.000Z',
    }));
    const page = { limit: 50, offset: 0, hasMore: true };

    listBuildingsMock.mockResolvedValue({ buildings });
    listEntrancesMock.mockResolvedValue({ entrances: [] });
    listUnitsMock.mockResolvedValue({ units: [], page });
    listResidentsMock.mockResolvedValue({ residents: [], page });
    listStaffMock.mockResolvedValue({ staff: [], page });
    listCompaniesMock.mockResolvedValue({ companies: [], page });
    listContractorUsersMock.mockResolvedValue({ users: [], page });
    listMembershipsMock.mockResolvedValue({ memberships: [], page });

    renderWithProviders(<PropertyDirectoryAdminPage />);

    expect(await screen.findByText('Корпус 13')).toBeInTheDocument();
    expect(screen.getByText(/не загружено/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить входы ещё' }));
    await waitFor(() => {
      expect(listEntrancesMock).toHaveBeenCalledWith(
        buildings[12].id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё юниты' }));
    await waitFor(() => {
      expect(listUnitsMock).toHaveBeenCalledWith(
        { is_active: true, limit: 100, q: undefined },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Жители' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё жителей' }));
    await waitFor(() => {
      expect(listResidentsMock).toHaveBeenCalledWith(
        { is_active: true, limit: 100, q: undefined },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё сотрудников' }));
    await waitFor(() => {
      expect(listStaffMock).toHaveBeenCalledWith(
        { is_active: true, limit: 100, q: undefined },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Подрядчики' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё компании' }));
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё пользователей' }));
    await waitFor(() => {
      expect(listCompaniesMock).toHaveBeenCalledWith(
        { status: 'active', limit: 100, q: undefined },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(listContractorUsersMock).toHaveBeenCalledWith(
        { is_active: true, limit: 100 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Членства' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё членства' }));
    await waitFor(() => {
      expect(listMembershipsMock).toHaveBeenCalledWith(
        { property_id: PROPERTY_ID, limit: 100 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  test('блокирует directory mutations без обязательных идентификаторов', async () => {
    setupDirectoryMocks();

    renderWithProviders(<PropertyDirectoryAdminPage />);

    expect(await screen.findByRole('heading', { name: /справочник объекта/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Создать вход' }));

    expect(await screen.findByText('Укажите entrance building ID')).toBeInTheDocument();
    expect(createEntranceMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить unit' }));

    expect(await screen.findByText('Укажите unit ID')).toBeInTheDocument();
    expect(getUnitByIdMock).not.toHaveBeenCalled();
  });
});
