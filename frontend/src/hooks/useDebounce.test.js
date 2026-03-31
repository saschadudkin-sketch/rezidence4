/**
 * hooks/useDebounce.test.js
 */
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './useDebounce';

vi.useFakeTimers();

test('возвращает начальное значение сразу', () => {
  const { result } = renderHook(() => useDebounce('hello', 300));
  expect(result.current).toBe('hello');
});

test('откладывает обновление на указанный delay', () => {
  const { result, rerender } = renderHook(
    ({ value }) => useDebounce(value, 300),
    { initialProps: { value: 'a' } }
  );
  rerender({ value: 'ab' });
  expect(result.current).toBe('a');
  act(() => vi.advanceTimersByTime(300));
  expect(result.current).toBe('ab');
});

test('сбрасывает таймер при быстрых изменениях', () => {
  const { result, rerender } = renderHook(
    ({ value }) => useDebounce(value, 300),
    { initialProps: { value: 'a' } }
  );
  rerender({ value: 'ab' });
  act(() => vi.advanceTimersByTime(100));
  rerender({ value: 'abc' });
  act(() => vi.advanceTimersByTime(200));
  expect(result.current).toBe('a');
  act(() => vi.advanceTimersByTime(100));
  expect(result.current).toBe('abc');
});
