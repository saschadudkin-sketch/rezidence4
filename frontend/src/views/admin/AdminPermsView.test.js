/**
 * views/admin/AdminPermsView.test.js
 * Покрывает: AdminPermsView — отображение перм-списков, поиск по жильцам, редактирование
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPermsView from './AdminPermsView';

jest.mock('../../hooks/useDebounce', () => ({ useDebounce: v => v }));

jest.mock('../../store/AppStore', () => ({
  useActions: () => ({
    setPerms: jest.fn(),
  }),
  useUsers: () => ({
    users: {
      u1: { uid: 'u1', name: 'Иван Петров',   role: 'owner',  apartment: '12' },
      u2: { uid: 'u2', name: 'Анна Соколова', role: 'tenant', apartment: '34' },
      g1: { uid: 'g1', name: 'Охранник',      role: 'security', apartment: null },
    },
  }),
  useAllPerms: () => ({
    u1: {
      visitors: [{ id: 'pv1', name: 'Гость Волков', phone: '+7 916 000-00-01' }],
      workers:  [{ id: 'pw1', name: 'Слесарь Иванов', phone: '+7 903 000-00-01', carPlate: 'А111ВС77' }],
    },
    u2: {
      visitors: [],
      workers:  [],
    },
  }),
  usePerms: (uid) => uid === 'u1'
    ? {
      visitors: [{ id: 'pv1', name: 'Гость Волков', phone: '' }],
      workers: [{ id: 'pw1', name: 'Слесарь Иванов', phone: '+7 903 000-00-01', carPlate: 'А111ВС77' }],
    }
    : { visitors: [], workers: [] },
}));

jest.mock('../../services/providers/serviceContainer', () => ({
  services: {
    admin: {
      savePermsEverywhere: jest.fn().mockResolvedValue('local'),
    },
  },
}));

jest.mock('../../ui/syncFeedback', () => ({ toastBySyncResult: jest.fn() }));
jest.mock('../../ui/Toasts',       () => ({ toast: jest.fn() }));

describe('AdminPermsView', () => {
  const user = { uid: 'a1', role: 'admin' };

  test('показывает список жильцов с перм-списками', () => {
    render(<AdminPermsView user={user} />);
    expect(screen.getByText(/Иван Петров/)).toBeInTheDocument();
    expect(screen.getByText(/Анна Соколова/)).toBeInTheDocument();
  });

  test('охранник не отображается (не resident)', () => {
    render(<AdminPermsView user={user} />);
    expect(screen.queryByText('Охранник')).not.toBeInTheDocument();
  });

  test('отображает посетителей жильца', () => {
    render(<AdminPermsView user={user} />);
    expect(screen.getByText('Гость Волков')).toBeInTheDocument();
  });

  test('отображает рабочих жильца', () => {
    render(<AdminPermsView user={user} />);
    fireEvent.click(screen.getByRole('button', { name: /рабочие/i }));
    expect(screen.getByText('Слесарь Иванов')).toBeInTheDocument();
  });

  test('отображает номер авто рабочего', () => {
    render(<AdminPermsView user={user} />);
    fireEvent.click(screen.getByRole('button', { name: /рабочие/i }));
    expect(screen.getByText(/А111ВС77/)).toBeInTheDocument();
  });

  test('поиск по имени жильца фильтрует список', () => {
    render(<AdminPermsView user={user} />);
    fireEvent.change(screen.getByPlaceholderText(/поиск/i), { target: { value: 'Анна' } });
    expect(screen.queryByText(/Иван Петров/)).not.toBeInTheDocument();
    expect(screen.getByText(/Анна Соколова/)).toBeInTheDocument();
  });

  test('кнопка редактирования записи открывает форму', () => {
    render(<AdminPermsView user={user} />);
    const editBtns = screen.getAllByLabelText('Редактировать');
    fireEvent.click(editBtns[0]);
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
  });

  test('пустое ФИО при сохранении показывает ошибку', async () => {
    const { toast } = require('../../ui/Toasts');
    render(<AdminPermsView user={user} />);
    const editBtns = screen.getAllByLabelText('Редактировать');
    fireEvent.click(editBtns[0]);
    const nameInput = screen.getByDisplayValue('Гость Волков');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите ФИО', 'error');
    });
  });
});
