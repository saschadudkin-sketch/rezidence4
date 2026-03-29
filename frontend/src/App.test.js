/**
 * App.test.js
 * Покрывает: App — фазы loading/login/dashboard, переход по useAuth
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import App from './App';

jest.mock('./store/AppStore', () => ({
  AppProvider: ({ children }) => <div data-testid="app-provider">{children}</div>,
  useUsers: () => ({ phoneDb: {}, users: {} }),
  useRequests: () => [],
  useActions: () => ({}),
}));

jest.mock('./hooks/useAuth', () => {
  const PHASE = { LOADING: 'loading', LOGIN: 'login', DASHBOARD: 'dashboard' };
  let _cb = null;
  const useAuth = jest.fn(() => ({
    phase: PHASE.LOADING,
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
  }));
  useAuth.PHASE = PHASE;
  useAuth.__setReturn = (val) => { useAuth.mockReturnValue(val); };
  return { useAuth, PHASE };
});

jest.mock('./views/Dashboard', () => () => <div data-testid="dashboard">Dashboard</div>);
jest.mock('./views/Login',     () => () => <div data-testid="login">Login</div>);
jest.mock('./ui/Toasts',       () => ({ __esModule: true, default: () => <div />, toast: jest.fn() }));
jest.mock('./ui/ErrorBoundary', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));
jest.mock('./constants/logo',  () => ({ LOGO: 'logo.svg' }));
jest.mock('./styles/theme.css', () => ({}), { virtual: true });

const { useAuth, PHASE } = require('./hooks/useAuth');

beforeEach(() => jest.clearAllMocks());

describe('App', () => {
  test('фаза LOADING — показывает экран загрузки', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: jest.fn(), logout: jest.fn() });
    render(<App />);
    expect(screen.getByText('Резиденции Замоскворечья')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  test('фаза LOGIN — показывает Login', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOGIN, user: null, login: jest.fn(), logout: jest.fn() });
    render(<App />);
    expect(screen.getByTestId('login')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  test('фаза DASHBOARD с user — показывает Dashboard', () => {
    const user = { uid: 'u1', role: 'owner', name: 'Иван' };
    useAuth.mockReturnValue({ phase: PHASE.DASHBOARD, user, login: jest.fn(), logout: jest.fn() });
    render(<App />);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });

  test('фаза DASHBOARD но user=null — fallback на LOGIN', () => {
    useAuth.mockReturnValue({ phase: PHASE.DASHBOARD, user: null, login: jest.fn(), logout: jest.fn() });
    render(<App />);
    expect(screen.getByTestId('login')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  test('AppProvider оборачивает всё приложение', () => {
    useAuth.mockReturnValue({ phase: PHASE.LOADING, user: null, login: jest.fn(), logout: jest.fn() });
    render(<App />);
    expect(screen.getByTestId('app-provider')).toBeInTheDocument();
  });
});
