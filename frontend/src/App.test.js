import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { useAuth, PHASE } from './hooks/useAuth';

vi.mock('./store/AppStore.jsx', () => ({
  AppProvider: ({ children }) => <div data-testid="app-provider">{children}</div>,
  useUsers: () => ({ phoneDb: {}, users: {} }),
  useRequests: () => [],
  useActions: () => ({}),
}));

vi.mock('./hooks/useAuth', () => ({
  useAuth: vi.fn(),
  PHASE: { LOADING: 'loading', LOGIN: 'login', DASHBOARD: 'dashboard' },
}));

vi.mock('./views/Dashboard.jsx', () => ({ default: () => <div data-testid="dashboard">Dashboard</div> }));
vi.mock('./views/Login.jsx', () => ({ default: () => <div data-testid="login">Login</div> }));
vi.mock('./ui/Toasts.jsx', () => ({ default: () => <div />, toast: vi.fn() }));
vi.mock('./ui/ErrorBoundary.jsx', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('./constants/logo', () => ({ LOGO: 'logo.svg' }));
vi.mock('./styles/theme.css', () => ({}), { virtual: true });

beforeEach(() => vi.clearAllMocks());

describe('App', () => {
  test('offline banner при visible=true содержит ARIA-атрибуты', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: vi.fn(), logout: vi.fn() });

    render(<App />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('Нет подключения к интернету')).toBeInTheDocument();
  });

  test('фаза LOADING — показывает экран загрузки', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(screen.getByText('Резиденции Замоскворечья')).toBeInTheDocument();
  });

  test('фаза LOGIN — показывает Login', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOGIN, user: null, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });

  test('фаза DASHBOARD с user — показывает Dashboard', () => {
    useAuth.mockReturnValue({ phase: PHASE.DASHBOARD, user: { uid: 'u1' }, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });

  test('AppProvider оборачивает всё приложение', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(screen.getByTestId('app-provider')).toBeInTheDocument();
  });
});
