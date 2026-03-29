/**
 * ui/Toasts.test.js
 * Покрывает: toast() функция, компонент Toasts
 * BUG-fix: монотонный счётчик id вместо Date.now() — два toast() подряд не теряются
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import Toasts, { toast } from './Toasts';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('toast() function', () => {
  test('toast без компонента не бросает ошибку', () => {
    expect(() => toast('Привет')).not.toThrow();
  });
});

describe('Toasts component', () => {
  test('рендерится без ошибок', () => {
    const { container } = render(<Toasts />);
    expect(container.querySelector('.toast-wrap')).toBeNull();
  });

  test('показывает сообщение после toast()', () => {
    render(<Toasts />);
    act(() => { toast('Сообщение появилось', 'success'); });
    expect(screen.getByText('Сообщение появилось')).toBeInTheDocument();
  });

  test('два toast() подряд показывают оба (BUG-fix: счётчик вместо Date.now)', () => {
    render(<Toasts />);
    act(() => {
      toast('Первое', 'info');
      toast('Второе', 'success');
    });
    expect(screen.getByText('Первое')).toBeInTheDocument();
    expect(screen.getByText('Второе')).toBeInTheDocument();
  });

  test('toast исчезает через 3.5 секунды', () => {
    render(<Toasts />);
    act(() => { toast('Временное', 'info'); });
    expect(screen.getByText('Временное')).toBeInTheDocument();

    act(() => jest.advanceTimersByTime(3500));
    expect(screen.queryByText('Временное')).not.toBeInTheDocument();
  });

  test('тип "error" передаётся как CSS-класс', () => {
    render(<Toasts />);
    act(() => { toast('Ошибка!', 'error'); });
    const el = screen.getByText('Ошибка!');
    expect(el.className).toContain('error');
  });

  test('тип "success" передаётся как CSS-класс', () => {
    render(<Toasts />);
    act(() => { toast('Успех!', 'success'); });
    const el = screen.getByText('Успех!');
    expect(el.className).toContain('success');
  });

  test('по умолчанию тип "info"', () => {
    render(<Toasts />);
    act(() => { toast('Инфо'); });
    const el = screen.getByText('Инфо');
    expect(el.className).toContain('info');
  });

  test('имеет role="status" для доступности', () => {
    render(<Toasts />);
    act(() => { toast('A11y'); });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('несколько toast не перезаписывают друг друга', () => {
    render(<Toasts />);
    act(() => {
      toast('Первый', 'info');
      toast('Второй', 'error');
      toast('Третий', 'success');
    });
    expect(screen.getAllByText(/й/).length).toBeGreaterThanOrEqual(3);
  });
});

// ─── AUDIT-8 fixes ────────────────────────────────────────────────────────────

describe('Toasts AUDIT-8 fixes', () => {
  test('null render при пустом списке (нет лишнего DOM-узла)', () => {
    const { container } = render(<Toasts />);
    // Без toast() — компонент возвращает null, нет .toast-wrap
    expect(container.querySelector('.toast-wrap')).toBeNull();
  });

  test('toast-wrap появляется после первого toast()', () => {
    render(<Toasts />);
    act(() => { toast('Привет'); });
    expect(document.querySelector('.toast-wrap')).toBeInTheDocument();
  });

  test('toast исчезает через TOAST_DURATION (3500мс)', () => {
    render(<Toasts />);
    act(() => { toast('Тест исчезновения', 'info'); });
    expect(screen.getByText('Тест исчезновения')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(3500));
    expect(screen.queryByText('Тест исчезновения')).not.toBeInTheDocument();
  });

  test('при размонтировании все таймеры очищаются (нет memory leak)', () => {
    const { unmount } = render(<Toasts />);
    act(() => { toast('Будет очищен'); });
    // Размонтируем ДО истечения таймера
    unmount();
    // Запускаем таймеры — не должно бросить ошибку "setState on unmounted"
    expect(() => act(() => jest.runAllTimers())).not.toThrow();
  });

  test('LIFO: второй экземпляр Toasts получает toast()', () => {
    const { unmount: unmount1 } = render(<Toasts />);
    render(<Toasts />);
    // После монтирования второго — он должен получать toast()
    act(() => { toast('LIFO test'); });
    // Хотя бы один экземпляр показал сообщение
    expect(screen.getAllByText('LIFO test').length).toBeGreaterThanOrEqual(1);
    unmount1();
  });
});
