import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AdminPassListItem, UserMe } from '../api/types';
import { V1SessionProvider } from '../store';

const { listPassesMock, revokePassMock, blockPassMock } = vi.hoisted(() => ({
  listPassesMock: vi.fn(),
  revokePassMock: vi.fn(),
  blockPassMock: vi.fn(),
}));

vi.mock('../api/passes', () => ({
  passesApi: {
    list: listPassesMock,
    revoke: revokePassMock,
    block: blockPassMock,
  },
}));

import { AccessAdminPage } from './AccessAdminPage';

const UUID_PROPERTY = '11111111-1111-4111-8111-111111111111';
const UUID_PASS = '22222222-2222-4222-8222-222222222222';

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
