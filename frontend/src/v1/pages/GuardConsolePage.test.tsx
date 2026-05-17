import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  SecurityWorkspaceBootstrap,
  SecurityWorkspaceSearchResult,
  UserMe,
  VisitLog,
} from '../api/types';

const {
  bootstrapMock,
  clearVehicleFlagsMock,
  revokePassMock,
  searchMock,
  guardVisitsListMock,
  guardVisitGetByIdMock,
  guardVisitsListByPassMock,
  guardVisitsListByPlateMock,
  guardVisitCreateMock,
  guardVisitVerifyMock,
  visitsListMock,
  visitsGetByIdMock,
  visitsListByPassMock,
  visitsListByPlateMock,
  visitsCreateMock,
  visitsScanPassMock,
} = vi.hoisted(() => ({
  bootstrapMock: vi.fn(),
  clearVehicleFlagsMock: vi.fn(),
  revokePassMock: vi.fn(),
  searchMock: vi.fn(),
  guardVisitsListMock: vi.fn(),
  guardVisitGetByIdMock: vi.fn(),
  guardVisitsListByPassMock: vi.fn(),
  guardVisitsListByPlateMock: vi.fn(),
  guardVisitCreateMock: vi.fn(),
  guardVisitVerifyMock: vi.fn(),
  visitsListMock: vi.fn(),
  visitsGetByIdMock: vi.fn(),
  visitsListByPassMock: vi.fn(),
  visitsListByPlateMock: vi.fn(),
  visitsCreateMock: vi.fn(),
  visitsScanPassMock: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    api: {
      ...actual.api,
      securityWorkspace: {
        ...actual.api.securityWorkspace,
        bootstrap: bootstrapMock,
        search: searchMock,
      },
      passes: {
        ...actual.api.passes,
        revoke: revokePassMock,
      },
      vehicles: {
        ...actual.api.vehicles,
        clearFlags: clearVehicleFlagsMock,
      },
      guardVisits: {
        list: guardVisitsListMock,
        getById: guardVisitGetByIdMock,
        listByPass: guardVisitsListByPassMock,
        listByPlate: guardVisitsListByPlateMock,
        create: guardVisitCreateMock,
        verify: guardVisitVerifyMock,
      },
      visits: {
        ...actual.api.visits,
        list: visitsListMock,
        getById: visitsGetByIdMock,
        listByPass: visitsListByPassMock,
        listByPlate: visitsListByPlateMock,
        create: visitsCreateMock,
        scanPass: visitsScanPassMock,
      },
    },
    isV1ApiError: () => false,
  };
});

vi.mock('../components/ScanPanel', () => ({
  ScanPanel: ({ onAccessPointChange, onVerified }: {
    onAccessPointChange?: (accessPointId: string | null) => void;
    onVerified?: () => void;
  }) => (
    <div data-testid="scan-panel">
      <button type="button" onClick={() => onAccessPointChange?.('33333333-3333-4333-8333-333333333333')}>
        Выбрать КПП
      </button>
      <button type="button" onClick={() => onVerified?.()}>
        Скан прошел
      </button>
    </div>
  ),
}));

import { V1SessionProvider } from '../store';
import { GuardConsolePage } from './GuardConsolePage';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function makeUser(overrides: Partial<UserMe> = {}): UserMe {
  return {
    uid: '22222222-2222-4222-8222-222222222222',
    role: 'security',
    name: 'Охрана',
    phone: null,
    apartment: null,
    avatar: null,
    property_slug: 'demo',
    property_id: PROPERTY_ID,
    property_type: 'residential_complex',
    ...overrides,
  };
}

function makeWorkspace(): SecurityWorkspaceBootstrap {
  return {
    property_id: PROPERTY_ID,
    generated_at: '2026-05-16T07:30:00.000Z',
    station_context: {
      access_point: {
        id: '33333333-3333-4333-8333-333333333333',
        property_id: PROPERTY_ID,
        zone_id: '44444444-4444-4444-8444-444444444444',
        name: 'КПП Север',
        point_type: 'vehicle_gate',
        provider: 'domhub',
        provider_external_id: 'gate-north',
      },
      access_zone: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Паркинг',
        zone_type: 'parking',
      },
    },
    expected_guests: [{
      id: '55555555-5555-4555-8555-555555555555',
      property_id: PROPERTY_ID,
      request_type: 'guest_pass',
      visitor_name: 'Анна Курьер',
      visitor_phone: '+79990001122',
      vehicle_id: '66666666-6666-4666-8666-666666666666',
      target_zone_id: null,
      target_point_id: null,
      target_unit_id: '77777777-7777-4777-8777-777777777777',
      reason: 'Доставка документов',
      guest_instructions: 'Вход через северный КПП',
      guard_notes: 'Проверить документы',
      starts_at: '2026-05-16T07:00:00.000Z',
      ends_at: '2026-05-16T09:00:00.000Z',
      status: 'approved',
      approval_required: false,
      plate_number: 'А001АА77',
      unit_number: '12',
      unit_type: 'apartment',
      pass_id: '88888888-8888-4888-8888-888888888888',
      pass_status: 'active',
    }],
    recent_events: [{
      id: '99999999-9999-4999-8999-999999999999',
      property_id: PROPERTY_ID,
      pass_id: '88888888-8888-4888-8888-888888888888',
      access_point_id: '33333333-3333-4333-8333-333333333333',
      event_type: 'entry_allowed',
      event_source: 'qr',
      person_label: 'Анна Курьер',
      vehicle_plate: 'А001АА77',
      performed_by_staff_id: null,
      occurred_at: '2026-05-16T07:20:00.000Z',
      created_at: '2026-05-16T07:20:01.000Z',
      access_point_name: 'КПП Север',
      access_zone_name: 'Паркинг',
      incident_id: null,
      incident_type: null,
      severity: null,
      incident_status: null,
    }],
    blacklist_hits: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      property_id: PROPERTY_ID,
      related_vehicle_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      related_visit_log_id: null,
      incident_type: 'blacklisted_vehicle',
      severity: 'high',
      status: 'open',
      title: 'Blacklist plate at barrier',
      created_at: '2026-05-16T07:10:00.000Z',
      plate_number: 'Х777ХХ77',
      owner_type: 'guest',
      is_blacklisted: true,
    }],
    active_passes: [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      property_id: PROPERTY_ID,
      pass_type: 'guest_qr',
      subject_type: 'vehicle',
      subject_resident_id: null,
      subject_staff_id: null,
      subject_contractor_user_id: null,
      subject_vehicle_id: '66666666-6666-4666-8666-666666666666',
      zone_id: '44444444-4444-4444-8444-444444444444',
      point_id: '33333333-3333-4333-8333-333333333333',
      policy_id: null,
      valid_from: '2026-05-16T07:00:00.000Z',
      valid_until: '2026-05-16T09:00:00.000Z',
      status: 'active',
      guest_instructions: 'Вход через северный КПП',
      guard_notes: 'Проверить документы',
      plate_number: 'А001АА77',
      is_whitelisted: false,
      is_blacklisted: false,
      resident_name: 'Иван Петров',
      resident_phone: '+79990000000',
      unit_number: '12',
      unit_type: 'apartment',
    }],
  };
}

function makeSearchResults(): SecurityWorkspaceSearchResult {
  return {
    query: 'А001',
    normalized_plate: 'А001АА77',
    vehicles: [{
      id: '66666666-6666-4666-8666-666666666666',
      property_id: PROPERTY_ID,
      unit_id: '77777777-7777-4777-8777-777777777777',
      owner_type: 'resident',
      plate_number: 'А001АА77',
      vehicle_type: 'car',
      color: 'Черный',
      brand: 'BMW',
      model: 'X5',
      is_whitelisted: true,
      is_blacklisted: false,
    }],
    residents: [{
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      property_id: PROPERTY_ID,
      unit_id: '77777777-7777-4777-8777-777777777777',
      full_name: 'Иван Петров',
      phone: '+79990000000',
      email: null,
      role: 'resident',
      resident_type: 'owner',
      is_active: true,
      unit_number: '12',
      unit_type: 'apartment',
    }],
    units: [{
      id: '77777777-7777-4777-8777-777777777777',
      property_id: PROPERTY_ID,
      building_id: null,
      entrance_id: null,
      unit_number: '12',
      unit_type: 'apartment',
      floor: 3,
      is_active: true,
    }],
    passes: [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      property_id: PROPERTY_ID,
      pass_type: 'guest_qr',
      subject_type: 'vehicle',
      subject_resident_id: null,
      subject_vehicle_id: '66666666-6666-4666-8666-666666666666',
      zone_id: '44444444-4444-4444-8444-444444444444',
      point_id: '33333333-3333-4333-8333-333333333333',
      valid_from: '2026-05-16T07:00:00.000Z',
      valid_until: '2026-05-16T09:00:00.000Z',
      status: 'active',
      plate_number: 'А001АА77',
      resident_name: 'Иван Петров',
      unit_number: '12',
    }],
  };
}

function makeVisitLog(overrides: Partial<VisitLog> = {}): VisitLog {
  return {
    id: '12121212-1212-4212-8212-121212121212',
    property_id: PROPERTY_ID,
    pass_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    access_point_id: '33333333-3333-4333-8333-333333333333',
    event_type: 'entry_allowed',
    event_source: 'guard_console',
    person_label: 'Анна Курьер',
    vehicle_plate: 'А001АА77',
    performed_by_staff_id: null,
    provider_event_id: null,
    provider_payload: null,
    occurred_at: '2026-05-16T07:25:00.000Z',
    created_at: '2026-05-16T07:25:01.000Z',
    ...overrides,
  };
}

function renderPage(user = makeUser()) {
  render(
    <MemoryRouter>
      <V1SessionProvider initialUser={user}>
        <GuardConsolePage />
      </V1SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  bootstrapMock.mockResolvedValue({ workspace: makeWorkspace() });
  clearVehicleFlagsMock.mockResolvedValue({
    vehicle: {
      ...makeSearchResults().vehicles[0],
      is_whitelisted: false,
      is_blacklisted: false,
      created_at: '2026-05-16T07:00:00.000Z',
      updated_at: '2026-05-16T07:40:00.000Z',
    },
  });
  revokePassMock.mockResolvedValue({ pass: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });
  searchMock.mockResolvedValue({ results: makeSearchResults() });
  guardVisitsListMock.mockResolvedValue({ visit_logs: [makeVisitLog()] });
  guardVisitGetByIdMock.mockResolvedValue({
    visit_log: makeVisitLog(),
    incidents: [{ id: 'abababab-abab-4aba-8aba-abababababab', incident_type: 'manual_override', severity: 'medium', status: 'open', title: 'Manual review', created_at: '2026-05-16T07:26:00.000Z' }],
  });
  guardVisitsListByPassMock.mockResolvedValue({ visit_logs: [makeVisitLog({ id: '13131313-1313-4313-8313-131313131313' })] });
  guardVisitsListByPlateMock.mockResolvedValue({ plate: 'А001АА77', visit_logs: [makeVisitLog({ id: '14141414-1414-4414-8414-141414141414' })] });
  guardVisitCreateMock.mockResolvedValue({ visit_log: makeVisitLog({ id: '15151515-1515-4515-8515-151515151515' }) });
  guardVisitVerifyMock.mockResolvedValue({
    allowed: true,
    visit_log_id: '16161616-1616-4616-8616-161616161616',
    incident_id: null,
    pass: null,
  });
  visitsListMock.mockResolvedValue({ visit_logs: [makeVisitLog({ id: '17171717-1717-4717-8717-171717171717' })] });
  visitsGetByIdMock.mockResolvedValue({ visit_log: makeVisitLog(), incidents: [] });
  visitsListByPassMock.mockResolvedValue({ visit_logs: [makeVisitLog()] });
  visitsListByPlateMock.mockResolvedValue({ plate: 'А001АА77', visit_logs: [makeVisitLog()] });
  visitsCreateMock.mockResolvedValue({ visit_log: makeVisitLog({ id: '18181818-1818-4818-8818-181818181818' }) });
  visitsScanPassMock.mockResolvedValue({
    allowed: false,
    reason: 'invalid_qr',
    visit_log_id: null,
    incident_id: '19191919-1919-4919-8919-191919191919',
    pass: null,
  });
});

describe('GuardConsolePage', () => {
  test('hydrates security workspace from bootstrap API', async () => {
    renderPage();

    expect((await screen.findAllByText('КПП Север · Паркинг')).length).toBeGreaterThan(0);
    expect(screen.getByText('Ожидаются: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Анна Курьер').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Въезд разрешён').length).toBeGreaterThan(0);
    expect(screen.getByText('Blacklist plate at barrier')).toBeInTheDocument();

    expect(bootstrapMock).toHaveBeenCalledWith(expect.objectContaining({
      property_id: PROPERTY_ID,
      access_point_id: null,
      active_passes_limit: 12,
      expected_guests_limit: 12,
      recent_events_limit: 12,
      blacklist_hits_limit: 8,
    }));
  });

  test('searches vehicles, residents, units and passes in workspace', async () => {
    renderPage();

    fireEvent.change(await screen.findByPlaceholderText('Номер, ФИО, квартира или pass id'), {
      target: { value: 'А001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        access_point_id: null,
        q: 'А001',
        limit: 8,
      });
    });
    expect(await screen.findByText('BMW')).toBeInTheDocument();
    expect(screen.getAllByText('Иван Петров').length).toBeGreaterThan(0);
    expect(screen.getByText('Whitelist')).toBeInTheDocument();
  });

  test('refreshes workspace when scan panel reports a verified event', async () => {
    renderPage();

    await screen.findAllByText('КПП Север · Паркинг');
    fireEvent.click(screen.getByRole('button', { name: 'Скан прошел' }));

    await waitFor(() => expect(bootstrapMock).toHaveBeenCalledTimes(2));
  });

  test('keeps quick guard actions for pass revoke and vehicle flags', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Отозвать' }));
    fireEvent.change(screen.getByLabelText('Причина отзыва'), {
      target: { value: 'Гость отменил визит' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отзыв' }));

    await waitFor(() => {
      expect(revokePassMock).toHaveBeenCalledWith(
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'Гость отменил визит',
      );
    });

    fireEvent.change(screen.getByPlaceholderText('Номер, ФИО, квартира или pass id'), {
      target: { value: 'А001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить флаги' }));

    await waitFor(() => {
      expect(clearVehicleFlagsMock).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666');
    });
  });

  test('drives guard visit-log list, detail, indexed search, create and verify workflows', async () => {
    renderPage();

    await screen.findByText('Visit-log операции');
    fireEvent.change(screen.getByLabelText('Visit log ID'), {
      target: { value: '12121212-1212-4212-8212-121212121212' },
    });
    fireEvent.change(screen.getByLabelText('Pass ID'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByLabelText('Номер авто'), {
      target: { value: 'А001АА77' },
    });
    fireEvent.change(screen.getByLabelText('Кто проходит'), {
      target: { value: 'Анна Курьер' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Список' }));
    await waitFor(() => {
      expect(guardVisitsListMock).toHaveBeenCalledWith({
        pass_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        vehicle_plate: 'А001АА77',
        event_type: 'entry_allowed',
        limit: 10,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Деталь' }));
    await waitFor(() => expect(guardVisitGetByIdMock).toHaveBeenCalledWith('12121212-1212-4212-8212-121212121212'));
    expect(await screen.findByText(/Инциденты: 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'По pass' }));
    await waitFor(() => {
      expect(guardVisitsListByPassMock).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { limit: 10 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'По номеру' }));
    await waitFor(() => {
      expect(guardVisitsListByPlateMock).toHaveBeenCalledWith('А001АА77', { limit: 10 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    await waitFor(() => {
      expect(guardVisitCreateMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        pass_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        access_point_id: null,
        event_type: 'entry_allowed',
        event_source: 'guard_console',
        person_label: 'Анна Курьер',
        vehicle_plate: 'А001АА77',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Guard verify' }));
    await waitFor(() => {
      expect(guardVisitVerifyMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        mode: 'plate',
        plate: 'А001АА77',
        access_point_id: null,
        direction: 'entry',
      });
    });
    expect(await screen.findByText(/Разрешено/)).toBeInTheDocument();
  });

  test('drives canonical visit-log list, create and scan-pass workflow', async () => {
    renderPage();

    await screen.findByText('Visit-log операции');
    fireEvent.change(screen.getByLabelText('Поверхность'), { target: { value: 'visits' } });
    fireEvent.change(screen.getByLabelText('Visit log ID'), {
      target: { value: '17171717-1717-4717-8717-171717171717' },
    });
    fireEvent.change(screen.getByLabelText('Pass ID'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByLabelText('Номер авто'), {
      target: { value: 'А001АА77' },
    });
    fireEvent.change(screen.getByLabelText('QR token'), {
      target: { value: 'qr-token-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Список' }));
    await waitFor(() => {
      expect(visitsListMock).toHaveBeenCalledWith({
        pass_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        vehicle_plate: 'А001АА77',
        event_type: 'entry_allowed',
        limit: 10,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Деталь' }));
    await waitFor(() => expect(visitsGetByIdMock).toHaveBeenCalledWith('17171717-1717-4717-8717-171717171717'));

    fireEvent.click(screen.getByRole('button', { name: 'По pass' }));
    await waitFor(() => {
      expect(visitsListByPassMock).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { limit: 10 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'По номеру' }));
    await waitFor(() => {
      expect(visitsListByPlateMock).toHaveBeenCalledWith('А001АА77', { limit: 10 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    await waitFor(() => {
      expect(visitsCreateMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        pass_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        access_point_id: null,
        event_type: 'entry_allowed',
        event_source: 'guard_console',
        person_label: null,
        vehicle_plate: 'А001АА77',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Scan pass' }));
    await waitFor(() => {
      expect(visitsScanPassMock).toHaveBeenCalledWith({
        property_id: PROPERTY_ID,
        token: 'qr-token-1',
        access_point_id: null,
        direction: 'entry',
      });
    });
    expect(await screen.findByText(/Запрещено · invalid_qr/)).toBeInTheDocument();
  });
});
