/**
 * ui/Modals.test.js
 * Покрывает: AddUserModal — рендер, валидация, добавление пользователя
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddUserModal } from './Modals';
import { toast } from './Toasts';

const mockAddUser = vi.fn();

vi.mock('../store/AppStore', () => ({
  useUsers:   () => ({ phoneDb: { '+79161234567': { uid: 'existing' } } }),
  useActions: () => ({ addUser: mockAddUser }),
}));

vi.mock('../utils', () => ({
  normalizePhone: vi.fn(p => '+7' + p.replace(/\D/g, '').slice(-10)),
  genId:          vi.fn(() => 'u-new'),
}));

vi.mock('./Toasts', () => ({
  toast: vi.fn(),
}));

vi.mock('./scrollLock', () => ({
  lockScroll:   vi.fn(),
  unlockScroll: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe('AddUserModal', () => {
  test('рендерится с заголовком "Новый собственник" (default role = owner)', () => {
    render(<AddUserModal onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('Новый собственник')).toBeInTheDocument();
  });

  test('поля Имя, Телефон, Роль, Апартамент присутствуют', () => {
    render(<AddUserModal onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByPlaceholderText('Иван Иванов')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+7 000 000-00-00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('12')).toBeInTheDocument();
  });

  test('кнопка закрытия вызывает onClose', () => {
    const onClose = vi.fn();
    render(<AddUserModal onClose={onClose} onDone={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalled();
  });

  test('кнопка "Отмена" вызывает onClose', () => {
    const onClose = vi.fn();
    render(<AddUserModal onClose={onClose} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText('Отмена'));
    expect(onClose).toHaveBeenCalled();
  });

  test('пустое имя показывает toast error', async () => {
    render(<AddUserModal onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('+7 000 000-00-00'), { target: { value: '+7 916 777-88-99' } });
    fireEvent.click(screen.getByText('Добавить пользователя'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите имя', 'error');
    });
  });

  test('некорректный телефон показывает toast error', async () => {
    render(<AddUserModal onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Иван' } });
    fireEvent.change(screen.getByPlaceholderText('+7 000 000-00-00'), { target: { value: '+7 916' } });
    fireEvent.click(screen.getByText('Добавить пользователя'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите корректный номер телефона', 'error');
    });
  });

  test('initialRole предустанавливает роль', () => {
    render(<AddUserModal onClose={vi.fn()} onDone={vi.fn()} initialRole="security" />);
    const select = screen.getByRole('combobox');
    expect(select.value).toBe('security');
  });

  test('успешное добавление вызывает addUser, onDone и onClose', async () => {
    const onDone  = vi.fn();
    const onClose = vi.fn();

    render(<AddUserModal onClose={onClose} onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText('Иван Иванов'), { target: { value: 'Новый Пользователь' } });
    fireEvent.change(screen.getByPlaceholderText('+7 000 000-00-00'), { target: { value: '+7 999 888-77-66' } });
    fireEvent.change(screen.getByPlaceholderText('12'), { target: { value: '42' } });

    // FIX: убрана искусственная задержка 400мс из AddUserModal.submit(),
    // поэтому timeout: 1000 больше не нужен — операция синхронная
    fireEvent.click(screen.getByText('Добавить пользователя'));

    await waitFor(() => {
      expect(mockAddUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Новый Пользователь' })
      );
      expect(onDone).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
