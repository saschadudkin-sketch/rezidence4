/**
 * hooks/useAuth.test.js
 * Тесты всех фаз useAuth и событий unauthorized.
 */

import { renderHook, act } from '@testing-library/react';
import { useAuth, PHASE } from './useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('начинает с фазы LOADING', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.phase).toBe(PHASE.LOADING);
  });

  it('переходит в LOGIN после splash delay', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { jest.advanceTimersByTime(1200); });
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('login устанавливает user и фазу DASHBOARD', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { jest.advanceTimersByTime(1200); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    expect(result.current.phase).toBe(PHASE.DASHBOARD);
    expect(result.current.user.uid).toBe('u1');
  });

  it('logout сбрасывает user и возвращает в LOGIN', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { jest.advanceTimersByTime(1200); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    act(() => { result.current.logout(); });
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('rz:unauthorized событие сбрасывает сессию', () => {
    const { result } = renderHook(() => useAuth());
    act(() => { jest.advanceTimersByTime(1200); });
    act(() => { result.current.login({ uid: 'u1', name: 'Test', role: 'owner' }); });
    act(() => { window.dispatchEvent(new CustomEvent('rz:unauthorized')); });
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe(PHASE.LOGIN);
  });

  it('user null при старте', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
  });
});
