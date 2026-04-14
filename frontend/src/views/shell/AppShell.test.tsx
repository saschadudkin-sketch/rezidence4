import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import AppShell from './AppShell';
import { NavigationContext } from './NavigationContext';
import type { AppUser } from '../../store/slices/usersSlice';

vi.mock('../../config/runtimeMode', () => ({
  isDemoMode: () => false,
}));

vi.mock('./NavigationShell', () => ({
  default: () => <nav data-testid="navigation-shell" />,
}));

vi.mock('./RoleContentRouter', () => ({
  default: () => <section data-testid="role-content-router" />,
}));

vi.mock('./UserMenu', () => ({
  default: () => <div data-testid="user-menu" />,
}));

const user: AppUser = {
  uid: 'u1',
  name: 'Тестовый пользователь',
  phone: '+79990000000',
  role: 'owner',
};

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('AppShell reconnect banner', () => {
  test('shows reconnect attempt counter in banner and header status', () => {
    render(
      <NavigationContext.Provider
        value={{
          nav: [],
          navClassMap: {},
          goTab: vi.fn(),
          activeTab: 'passes',
          setActiveTab: vi.fn(),
          highlightReqId: null,
          setHighlightReqId: vi.fn(),
        }}
      >
        <AppShell
          user={user}
          onLogout={vi.fn()}
          pageTitle="Пропуска"
          pageSubtitle="Текущий экран"
          pendingCount={0}
          cycleTheme={vi.fn()}
          themeIcon="sun"
          themeLabel="Светлая"
          sseOnline={false}
          reconnectAttempt={2}
          maxReconnectAttempts={5}
          isOnline
        />
      </NavigationContext.Provider>,
    );

    expect(screen.getByText('Нет соединения с сервером, идет переподключение (попытка 2/5)')).toBeInTheDocument();
    expect(screen.getByText('Переподключение (попытка 2/5)')).toBeInTheDocument();
  });
});
