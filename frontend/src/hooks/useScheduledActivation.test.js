/**
 * hooks/useScheduledActivation.test.js
 * Покрывает: useScheduledActivation
 * Проверяет: вызов activateScheduled при монтировании, интервал 30s,
 *            интервал срабатывает только при наличии 'scheduled' заявок,
 *            очистка интервала при размонтировании
 */

import { renderHook, act } from '@testing-library/react';
import { useScheduledActivation } from './useScheduledActivation';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const mkReq = (status) => ({ id: status + '-1', status });

describe('useScheduledActivation', () => {
  test('вызывает activateScheduled сразу при монтировании', () => {
    const activate = jest.fn();
    renderHook(() => useScheduledActivation([], activate));
    expect(activate).toHaveBeenCalledTimes(1);
  });

  test('запускает интервал 30 секунд', () => {
    const activate = jest.fn();
    renderHook(() => useScheduledActivation([mkReq('scheduled')], activate));

    act(() => jest.advanceTimersByTime(30_000));
    expect(activate).toHaveBeenCalledTimes(2); // mount + interval
  });

  test('не вызывает activateScheduled повторно если нет scheduled заявок', () => {
    const activate = jest.fn();
    const requests = [mkReq('pending'), mkReq('approved')];
    renderHook(() => useScheduledActivation(requests, activate));

    act(() => jest.advanceTimersByTime(30_000));
    expect(activate).toHaveBeenCalledTimes(1); // только при монтировании
  });

  test('вызывает повторно если есть хотя бы одна scheduled заявка', () => {
    const activate = jest.fn();
    const requests = [mkReq('pending'), mkReq('scheduled'), mkReq('approved')];
    renderHook(() => useScheduledActivation(requests, activate));

    act(() => jest.advanceTimersByTime(60_000)); // 2 интервала
    expect(activate).toHaveBeenCalledTimes(3); // mount + 2 intervals
  });

  test('очищает интервал при размонтировании', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const activate = jest.fn();
    const { unmount } = renderHook(() =>
      useScheduledActivation([mkReq('scheduled')], activate)
    );

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  test('после размонтирования интервал не срабатывает', () => {
    const activate = jest.fn();
    const { unmount } = renderHook(() =>
      useScheduledActivation([mkReq('scheduled')], activate)
    );

    unmount();
    act(() => jest.advanceTimersByTime(30_000));
    // Только один вызов — при монтировании
    expect(activate).toHaveBeenCalledTimes(1);
  });

  test('ref обновляется при изменении requests — интервал видит свежие данные', () => {
    const activate = jest.fn();
    // Начинаем без scheduled
    const { rerender } = renderHook(
      ({ requests }) => useScheduledActivation(requests, activate),
      { initialProps: { requests: [mkReq('pending')] } }
    );

    act(() => jest.advanceTimersByTime(30_000));
    expect(activate).toHaveBeenCalledTimes(1); // интервал не сработал (нет scheduled)

    // Добавляем scheduled заявку
    rerender({ requests: [mkReq('pending'), mkReq('scheduled')] });

    act(() => jest.advanceTimersByTime(30_000));
    expect(activate).toHaveBeenCalledTimes(2); // теперь интервал сработал
  });
});
