import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AccessRequestForm } from './AccessRequestForm';
import type { AccessRequest, AccessPoint, AccessZone, Unit, Vehicle } from '../api/types';

const { createMock, getQrMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getQrMock: vi.fn(),
}));

vi.mock('../api/accessRequests', () => ({
  accessRequestsApi: {
    create: createMock,
  },
}));

vi.mock('../api/passes', () => ({
  passesApi: {
    getQr: getQrMock,
  },
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    isV1ApiError: () => false,
  };
});

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const UNIT_ID = '22222222-2222-4222-8222-222222222222';
const ZONE_ID = '33333333-3333-4333-8333-333333333333';
const POINT_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const PASS_ID = '66666666-6666-4666-8666-666666666666';

function makeRequest(): AccessRequest {
  return {
    id: REQUEST_ID,
    property_id: PROPERTY_ID,
    created_by_type: 'resident',
    created_by_resident_id: '77777777-7777-4777-8777-777777777777',
    created_by_staff_id: null,
    created_by_contractor_user_id: null,
    request_type: 'courier_access',
    visitor_name: 'Курьер',
    visitor_phone: null,
    vehicle_id: null,
    target_zone_id: ZONE_ID,
    target_point_id: POINT_ID,
    target_unit_id: UNIT_ID,
    reason: 'Документы',
    guest_instructions: 'Вход через КПП Север',
    guard_notes: 'Проверить документы',
    share_delivery_channels: ['link', 'qr'],
    starts_at: '2026-05-16T10:00:00.000Z',
    ends_at: '2026-05-16T12:00:00.000Z',
    status: 'approved',
    approval_required: false,
    approved_at: '2026-05-16T09:55:00.000Z',
    rejected_at: null,
    cancelled_at: null,
    created_at: '2026-05-16T09:50:00.000Z',
    updated_at: '2026-05-16T09:55:00.000Z',
  };
}

describe('AccessRequestForm Phase 3 UX payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue({
      access_request: makeRequest(),
      pass: {
        id: PASS_ID,
        pass_type: 'courier',
        status: 'active',
        valid_from: '2026-05-16T10:00:00.000Z',
        valid_until: '2026-05-16T12:00:00.000Z',
      },
    });
    getQrMock.mockResolvedValue({ qr: { id: 'qr-1', token: 'a'.repeat(32), render_version: 1, created_at: '2026-05-16T09:55:00.000Z' } });
  });

  test('submits product fields and surfaces public share link after auto-approval', async () => {
    const onCreated = vi.fn();
    const zones: AccessZone[] = [{
      id: ZONE_ID,
      property_id: PROPERTY_ID,
      building_id: null,
      name: 'Периметр',
      zone_type: 'perimeter',
      description: null,
      is_active: true,
      sort_order: 0,
      metadata: null,
      created_at: '2026-05-16T09:00:00.000Z',
      updated_at: null,
    }];
    const points: AccessPoint[] = [{
      id: POINT_ID,
      property_id: PROPERTY_ID,
      zone_id: ZONE_ID,
      name: 'КПП Север',
      point_type: 'gate',
      provider: null,
      provider_external_id: null,
      description: null,
      is_active: true,
      sort_order: 0,
      metadata: null,
      created_at: '2026-05-16T09:00:00.000Z',
      updated_at: null,
    }];

    render(
      <AccessRequestForm
        propertyId={PROPERTY_ID}
        units={[{ id: UNIT_ID, unit_number: '12', unit_type: 'apartment' } as Pick<Unit, 'id' | 'unit_number' | 'unit_type'>]}
        vehicles={[] as Vehicle[]}
        zones={zones}
        points={points}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Курьер' }));
    fireEvent.change(screen.getByLabelText('Имя посетителя'), { target: { value: 'Курьер' } });
    fireEvent.change(screen.getByLabelText('Зона доступа'), { target: { value: ZONE_ID } });
    fireEvent.change(screen.getByLabelText('КПП / вход'), { target: { value: POINT_ID } });
    fireEvent.change(screen.getByLabelText('Комментарий (необязательно)'), { target: { value: 'Документы' } });
    fireEvent.change(screen.getByLabelText('Инструкция для гостя (необязательно)'), { target: { value: 'Вход через КПП Север' } });
    fireEvent.change(screen.getByLabelText('Заметка для охраны (необязательно)'), { target: { value: 'Проверить документы' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      request_type: 'courier_access',
      target_zone_id: ZONE_ID,
      target_point_id: POINT_ID,
      guest_instructions: 'Вход через КПП Север',
      guard_notes: 'Проверить документы',
      share_delivery_channels: ['link', 'qr'],
    }));
    expect(onCreated).toHaveBeenCalledWith(makeRequest(), expect.objectContaining({ id: PASS_ID }));
    expect(await screen.findByText(`${window.location.origin}/p/${'a'.repeat(32)}`)).toBeInTheDocument();
  });

  test('shows retry when QR link fetch fails after auto-approval', async () => {
    const onCreated = vi.fn();
    getQrMock
      .mockRejectedValueOnce(new Error('qr unavailable'))
      .mockResolvedValueOnce({ qr: { id: 'qr-2', token: 'b'.repeat(32), render_version: 1, created_at: '2026-05-16T09:56:00.000Z' } });

    render(
      <AccessRequestForm
        propertyId={PROPERTY_ID}
        units={[{ id: UNIT_ID, unit_number: '12', unit_type: 'apartment' } as Pick<Unit, 'id' | 'unit_number' | 'unit_type'>]}
        vehicles={[] as Vehicle[]}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText('Имя посетителя'), { target: { value: 'Гость' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }));

    expect(await screen.findByText(/Не удалось получить ссылку\/QR/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Получить ссылку' }));

    expect(await screen.findByText(`${window.location.origin}/p/${'b'.repeat(32)}`)).toBeInTheDocument();
    expect(getQrMock).toHaveBeenCalledTimes(2);
  });
});
