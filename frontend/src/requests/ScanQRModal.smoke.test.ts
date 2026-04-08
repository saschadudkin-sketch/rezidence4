import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ScanQRModal } from './ScanQRModal';

Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(global.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
});

vi.mock('../ui/Toasts',     () => ({ toast: vi.fn() }));
vi.mock('../ui/scrollLock', () => ({ lockScroll: vi.fn(), unlockScroll: vi.fn() }));
vi.mock('../shared/api/passesApi', () => ({ logVisit: vi.fn().mockResolvedValue({}) }));
vi.mock('../services/pushNotification', () => ({ pushNotifyResident: vi.fn() }));
vi.mock('../store/slices/blacklistSlice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/slices/blacklistSlice')>();
  return { ...actual, checkBlacklist: () => null };
});
vi.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { updateEverywhere: vi.fn().mockResolvedValue('local') } },
}));

describe('ScanQRModal', () => {
  test('рендерится без ошибок', async () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    await act(async () => {
      expect(() => render(<ScanQRModal user={user} onClose={vi.fn()} />)).not.toThrow();
      await Promise.resolve();
    });
  });

  test('показывает заголовок сканирования', async () => {
    const user = { uid:'g1', role:'security', name:'Охрана' };
    await act(async () => {
      render(<ScanQRModal user={user} onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(screen.getByText(/сканир|qr/i)).toBeInTheDocument();
  });
});
