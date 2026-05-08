import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import UserMenu from './UserMenu';
import type { AppUser } from '../../store/slices/usersSlice';

vi.mock('../../store/AppStore', () => ({
  useAvatar: () => null,
  useActions: () => ({
    setAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
  }),
}));

vi.mock('../../ui/AvatarCircle', () => ({
  AvatarCircle: ({ name }: { name: string }) => <span>{name.slice(0, 1)}</span>,
}));

vi.mock('../../ui/Modals', () => ({
  AvatarModal: () => null,
}));

vi.mock('../../ui/Toasts', () => ({
  toast: vi.fn(),
}));

const user: AppUser = {
  uid: 'security-1',
  name: 'Игорь Смирнов',
  phone: '+79175678901',
  role: 'security',
};

describe('UserMenu', () => {
  test('moves theme action into dropdown menu', () => {
    const cycleTheme = vi.fn();

    render(
      <UserMenu
        user={user}
        pendingCount={0}
        onLogout={vi.fn()}
        cycleTheme={cycleTheme}
        themeIcon="moon"
        themeLabel="Тёмная"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /меню пользователя/i }));
    fireEvent.click(screen.getByRole('button', { name: /сменить тему\. сейчас: тёмная/i }));

    expect(cycleTheme).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /меню пользователя/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /сменить тему\. сейчас: тёмная/i })).not.toBeInTheDocument();
  });
});
