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
} = vi.hoisted(() => ({
  listBuildingsMock: vi.fn(),
  listEntrancesMock: vi.fn(),
  listUnitsMock: vi.fn(),
  listResidentsMock: vi.fn(),
  listStaffMock: vi.fn(),
  listCompaniesMock: vi.fn(),
  listContractorUsersMock: vi.fn(),
  listMembershipsMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      units: {
        listBuildings: listBuildingsMock,
        listEntrances: listEntrancesMock,
        list: listUnitsMock,
      },
      residents: {
        list: listResidentsMock,
      },
      staff: {
        list: listStaffMock,
      },
      contractors: {
        listCompanies: listCompaniesMock,
        listUsers: listContractorUsersMock,
      },
      memberships: {
        list: listMembershipsMock,
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
});
