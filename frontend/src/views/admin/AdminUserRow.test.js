/**
 * views/admin/AdminUserRow.test.js
 * Покрывает: AdminUserRow — отображение пользователя, редактирование, удаление, RBAC
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminUserRow from './AdminUserRow.jsx';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../store/AppStore', () => ({
  useActions: () => ({
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  }),
  useAvatar: () => null,
}));

vi.mock('../../services/providers/serviceContainer', () => ({
  services: {
    admin: {
      saveUserEverywhere:   vi.fn().mockResolvedValue('local'),
      removeUserEverywhere: vi.fn().mockResolvedValue('local'),
    },
  },
}));

vi.mock('../../ui/syncFeedback', () => ({
  toastBySyncResult: vi.fn(),
}));

vi.mock('../../ui/Toasts.jsx', () => ({
  toast: vi.fn(),
}));

vi.mock('../../ui/AvatarCircle.jsx', () => ({
  AvatarCircle: ({ name }) => <div data-testid="avatar">{name[0]}</div>,
}));

import { services } from '../../services/providers/serviceContainer';
import { toast } from '../../ui/Toasts.jsx';

beforeEach(() => vi.clearAllMocks());

const adminUser = { uid: 'a1', role: 'admin', name: 'Администратор' };
const targetUser = {
  uid: 'u1', name: 'Иван Петров', phone: '+7 916 123-45-67',
  role: 'owner', apartment: '12',
};

describe('AdminUserRow', () => {
  test('отображает имя и телефон пользователя', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByText('+7 916 123-45-67')).toBeInTheDocument();
  });

  test('отображает апартамент', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    expect(screen.getByText('Апарт. 12')).toBeInTheDocument();
  });

  test('показывает метку "• это вы" для текущего пользователя', () => {
    render(<AdminUserRow u={adminUser} currentUser={adminUser} />);
    expect(screen.getByText('• это вы')).toBeInTheDocument();
  });

  test('НЕ показывает метку "• это вы" для другого пользователя', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    expect(screen.queryByText('• это вы')).not.toBeInTheDocument();
  });

  test('кнопка удаления видна если canDeleteUser', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    expect(screen.getByLabelText('Удалить пользователя')).toBeInTheDocument();
  });

  test('кнопка удаления НЕ видна для себя (admin не может удалить сам себя)', () => {
    render(<AdminUserRow u={adminUser} currentUser={adminUser} />);
    expect(screen.queryByLabelText('Удалить пользователя')).not.toBeInTheDocument();
  });

  test('клик на ✏️ открывает форму редактирования', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Отмена')).toBeInTheDocument();
  });

  test('форма предзаполнена текущими данными', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    expect(screen.getByPlaceholderText('Имя')).toHaveValue('Иван Петров');
    expect(screen.getByPlaceholderText('Телефон')).toHaveValue('+7 916 123-45-67');
  });

  test('Отмена закрывает форму', () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    fireEvent.click(screen.getByText('Отмена'));
    expect(screen.queryByText('Сохранить')).not.toBeInTheDocument();
  });

  test('пустое имя показывает ошибку', async () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    const nameInput = screen.getByPlaceholderText('Имя');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите имя', 'error');
    });
  });

  test('сохранение вызывает saveUserEverywhere', async () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    const nameInput = screen.getByPlaceholderText('Имя');
    fireEvent.change(nameInput, { target: { value: 'Иван Новый' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(services.admin.saveUserEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'u1',
          patch: expect.objectContaining({ name: 'Иван Новый' }),
        })
      );
    });
  });

  test('удаление вызывает removeUserEverywhere', async () => {
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Удалить пользователя'));
    await waitFor(() => {
      expect(services.admin.removeUserEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'u1' })
      );
    });
  });

  test('ошибка сохранения показывает toast error', async () => {
    services.admin.saveUserEverywhere.mockRejectedValueOnce(new Error('Сбой'));
    render(<AdminUserRow u={targetUser} currentUser={adminUser} />);
    fireEvent.click(screen.getByLabelText('Редактировать'));
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Ошибка сохранения', 'error');
    });
  });
});
