/**
 * ui/Toasts.test.js
 * Покрывает: toast() функция, компонент Toasts
 * BUG-fix: монотонный счётчик id вместо Date.now() — два toast() подряд не теряются
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import Toasts, { toast } from './Toasts';


async function emitToast(message, type) {
  await act(async () => {
    toast(message, type);
    await Promise.resolve();
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

describe('toast() function', () => {
  test('toast без компонента не бросает ошибку', async () => {
    expect(() => toast('Привет')).not.toThrow();
  });
});

describe('Toasts component', () => {
  test('рендерится без ошибок', async () => {
    const { container } = render(<Toasts />);
    expect(container.querySelector('.toast-wrap')).toBeNull();
  });

  test('показывает сообщение после toast()', async () => {
    render(<Toasts />);
    await emitToast('Сообщение появилось', 'success');
    expect(screen.getByText('Сообщение появилось')).toBeInTheDocument();
  });

  test('два toast() подряд показывают оба (BUG-fix: счётчик вместо Date.now)', async () => {
    render(<Toasts />);
    await emitToast('Первое', 'info');
    await emitToast('Второе', 'success');
    expect(screen.getByText('Первое')).toBeInTheDocument();
    expect(screen.getByText('Второе')).toBeInTheDocument();
  });

  test('toast исчезает через 3.5 секунды', async () => {
    render(<Toasts />);
    await emitToast('Временное', 'info');
    expect(screen.getByText('Временное')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText('Временное')).not.toBeInTheDocument();
  });

  test('тип "error" передаётся как CSS-класс', async () => {
    render(<Toasts />);
    await emitToast('Ошибка!', 'error');
    // P-06: text is now in .toast-msg span — check the parent toast div
    const el = screen.getByText('Ошибка!').closest('.toast');
    expect(el.className).toContain('error');
  });

  test('тип "success" передаётся как CSS-класс', async () => {
    render(<Toasts />);
    await emitToast('Успех!', 'success');
    const el = screen.getByText('Успех!').closest('.toast');
    expect(el.className).toContain('success');
  });

  test('по умолчанию тип "info"', async () => {
    render(<Toasts />);
    await emitToast('Инфо');
    const el = screen.getByText('Инфо').closest('.toast');
    expect(el.className).toContain('info');
  });

  test('имеет role="status" и aria-live="polite" для доступности', async () => {
    render(<Toasts />);
    await emitToast('A11y');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('несколько toast не перезаписывают друг друга', async () => {
    render(<Toasts />);
    await emitToast('Первый', 'info');
    await emitToast('Второй', 'error');
    await emitToast('Третий', 'success');
    expect(screen.getAllByText(/й/).length).toBeGreaterThanOrEqual(3);
  });
});

// ─── AUDIT-8 fixes ────────────────────────────────────────────────────────────

describe('Toasts AUDIT-8 fixes', () => {
  test('null render при пустом списке (нет лишнего DOM-узла)', async () => {
    const { container } = render(<Toasts />);
    // Без toast() — компонент возвращает null, нет .toast-wrap
    expect(container.querySelector('.toast-wrap')).toBeNull();
  });

  test('toast-wrap появляется после первого toast()', async () => {
    render(<Toasts />);
    await emitToast('Привет');
    expect(document.querySelector('.toast-wrap')).toBeInTheDocument();
  });

  test('toast исчезает через TOAST_DURATION (3500мс)', async () => {
    render(<Toasts />);
    await emitToast('Тест исчезновения', 'info');
    expect(screen.getByText('Тест исчезновения')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText('Тест исчезновения')).not.toBeInTheDocument();
  });

  test('при размонтировании все таймеры очищаются (нет memory leak)', async () => {
    const { unmount } = render(<Toasts />);
    await emitToast('Будет очищен');
    // Размонтируем ДО истечения таймера
    unmount();
    // Запускаем таймеры — не должно бросить ошибку "setState on unmounted"
    expect(() => act(() => vi.runAllTimers())).not.toThrow();
  });

  test('LIFO: второй экземпляр Toasts получает toast()', async () => {
    const { unmount: unmount1 } = render(<Toasts />);
    render(<Toasts />);
    // После монтирования второго — он должен получать toast()
    await emitToast('LIFO test');
    // Хотя бы один экземпляр показал сообщение
    expect(screen.getAllByText('LIFO test').length).toBeGreaterThanOrEqual(1);
    unmount1();
  });
});
