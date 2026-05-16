import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import GuestPassPage from './GuestPassPage';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn(async () => 'data:image/png;base64,qr'),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: toDataURLMock,
  },
}));

function renderAt(token: string) {
  render(
    <MemoryRouter initialEntries={[`/p/${token}`]}>
      <Routes>
        <Route path="/p/:token" element={<GuestPassPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('GuestPassPage', () => {
  test('loads and renders platform-v1 public pass token', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'active',
        visitorName: 'Анна Курьер',
        propertyName: 'ЖК Замоскворечье',
        apartment: '12',
        destinationLabel: 'Квартира 12',
        validFrom: '2026-05-16T10:00:00.000Z',
        validUntil: '2099-05-16T12:00:00.000Z',
        type: 'Гостевой',
        passType: 'guest',
        accessPointName: 'КПП Север',
        accessZoneName: 'Паркинг',
        guestInstructions: null,
      }),
    } as Response);

    renderAt('a'.repeat(32));

    expect(await screen.findByText('Анна Курьер')).toBeInTheDocument();
    expect(screen.getByText('Действителен')).toBeInTheDocument();
    expect(screen.getByText('Квартира 12')).toBeInTheDocument();
    expect(screen.getByText('КПП Север · Паркинг')).toBeInTheDocument();
    expect(screen.getByAltText('QR-код пропуска')).toHaveAttribute('src', 'data:image/png;base64,qr');
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/pass/${'a'.repeat(32)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
  });

  test('renders revoked state without active-pass chip', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'revoked',
        visitorName: 'Гость',
        propertyName: null,
        apartment: null,
        destinationLabel: null,
        validUntil: '2099-05-16T12:00:00.000Z',
        type: 'Гостевой',
        passType: 'guest',
        accessPointName: null,
        accessZoneName: null,
        guestInstructions: null,
      }),
    } as Response);

    renderAt('b'.repeat(32));

    expect(await screen.findByText('Отозван')).toBeInTheDocument();
    expect(screen.queryByText('Одноразовый проход')).not.toBeInTheDocument();
  });

  test('accepts legacy 64-hex public token links', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'active',
        visitorName: 'Курьер',
        propertyName: null,
        apartment: '45',
        destinationLabel: 'Квартира 45',
        validUntil: '2099-05-16T12:00:00.000Z',
        type: 'delivery',
        passType: 'delivery',
        accessPointName: null,
        accessZoneName: null,
        guestInstructions: null,
      }),
    } as Response);

    renderAt('c'.repeat(64));

    expect(await screen.findByText('Курьер')).toBeInTheDocument();
    expect(screen.getByText(/Доставка/)).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/v1/public/pass/${'c'.repeat(64)}`, expect.any(Object));
  });

  test('renders future pass as pending without active-pass chip', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'pending',
        visitorName: 'Будущий гость',
        propertyName: null,
        apartment: '8',
        destinationLabel: 'Квартира 8',
        validFrom: '2099-05-16T10:00:00.000Z',
        validUntil: '2099-05-16T12:00:00.000Z',
        type: 'Гостевой',
        passType: 'guest',
        accessPointName: null,
        accessZoneName: null,
        guestInstructions: null,
      }),
    } as Response);

    renderAt('d'.repeat(32));

    expect(await screen.findByText('Действует позже')).toBeInTheDocument();
    expect(screen.queryByText('Одноразовый проход')).not.toBeInTheDocument();
  });

  test('rejects invalid token without calling public endpoint', async () => {
    renderAt('not-a-token');

    expect(await screen.findByRole('alert')).toHaveTextContent('Некорректная ссылка пропуска.');
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
