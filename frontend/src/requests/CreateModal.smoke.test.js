import React from 'react';
import { render, screen } from '@testing-library/react';
import { CreateModal } from './CreateModal';

vi.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { submit: vi.fn().mockResolvedValue({ id:'srv-1' }), resolvePhotos: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/scrollLock', () => ({ lockScroll: vi.fn(), unlockScroll: vi.fn() }));
vi.mock('../store/slices/blacklistSlice', () => ({ checkBlacklist: () => null }));

describe('CreateModal', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    expect(() => render(<CreateModal user={user} type="pass" category="guest" onClose={vi.fn()} onDone={vi.fn()} />)).not.toThrow();
  });

  test('показывает заголовок формы', () => {
    const user = { uid:'u1', role:'owner', name:'Иван', apartment:'12' };
    render(<CreateModal user={user} type="pass" category="guest" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getAllByText(/новая заявка|пропуск|создать/i).length).toBeGreaterThan(0);
  });
});
