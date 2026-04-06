import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import { useAuth, PHASE } from './hooks/useAuth';

vi.mock('./store/AppStore', () => ({
  AppProvider: ({ children }) => <div data-testid="app-provider">{children}</div>,
  useUsers: () => ({ phoneDb: {}, users: {} }),
  useRequests: () => [],
  useActions: () => ({}),
}));

vi.mock('./hooks/useAuth', () => ({
  useAuth: vi.fn(),
  PHASE: { LOADING: 'loading', LOGIN: 'login', DASHBOARD: 'dashboard' },
}));

vi.mock('./views/Dashboard', () => ({ default: () => <div data-testid="dashboard">Dashboard</div> }));
vi.mock('./views/Login', () => ({ default: () => <div data-testid="login">Login</div> }));
vi.mock('./ui/Toasts', () => ({ default: () => <div />, toast: vi.fn() }));
vi.mock('./ui/ErrorBoundary', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('./constants/logo', () => ({ LOGO: 'logo.svg' }));
vi.mock('./styles/theme.css', () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/dashboard');
});

describe('App', () => {
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

  test('фаза DASHBOARD с user — показывает Dashboard', async () => {
    useAuth.mockReturnValue({ phase: PHASE.DASHBOARD, user: { uid: 'u1' }, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
  });

  test('AppProvider оборачивает всё приложение', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: vi.fn(), logout: vi.fn() });
    render(<App />);
    expect(screen.getByTestId('app-provider')).toBeInTheDocument();
  });
});
