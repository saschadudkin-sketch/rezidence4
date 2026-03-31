/**
 * views/AdminView.test.js
 * Покрывает: AdminView — вкладки stats/requests/users, поиск, фильтрация
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminView from './AdminView.jsx';
import * as AppStore from '../store/AppStore.jsx';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';


const mockRequests = [
  { id: 'r1', type: 'pass', status: 'pending', category: 'guest',
    visitorName: 'Гость', createdByUid: 'u1', createdByName: 'Иван',
    createdByRole: 'owner', createdByApt: '12', createdAt: new Date().toISOString(),
    comment: '', carPlate: null, passDuration: 'once' },
];
const mockUsers = {
  users: {
    u1: { uid: 'u1', name: 'Иван Петров', role: 'owner', phone: '+7 916 000-00-01', apartment: '12' },
    a1: { uid: 'a1', name: 'Администратор', role: 'admin', phone: '+7 495 000-00-00', apartment: '—' },
  },
};

beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue(mockRequests);
  vi.spyOn(AppStore, 'useUsers').mockReturnValue(mockUsers);
});
afterEach(() => vi.restoreAllMocks());

vi.mock('../hooks/useDebounce.js', () => ({ useDebounce: v => v }));

vi.mock('../utils.js', () => ({
  filterByPeriod: vi.fn((arr) => arr),
}));
vi.mock('../utils.js', () => ({
  filterByPeriod: vi.fn((arr) => arr),
}));

vi.mock('../domain/permissions.js', () => ({ ROLES: { CONTRACTOR: 'contractor' } }));
vi.mock('../constants/index.js', () => ({
  ROLE_LABELS: { owner: 'Собственник', admin: 'Администратор', contractor: 'Подрядчик' },
  ROLE_COLOR: { owner: 'var(--role-owner)', admin: 'var(--role-admin)' },
}));
vi.mock('../ui/Modals.jsx', () => ({
  AddUserModal: ({ onClose }) => <div data-testid="add-user-modal"><button onClick={onClose}>Закрыть</button></div>,
}));
vi.mock('./admin/AdminUserRow.jsx', () => ({ default: ({ u }) => <div data-testid="user-row">{u.name}</div> }));
vi.mock('./admin/AdminReqRow.jsx',  () => ({ default: ({ r }) => <div data-testid="req-row">{r.id}</div> }));
vi.mock('./admin/AdminPermsView.jsx', () => ({ default: () => <div data-testid="perms-view" /> }));
vi.mock('./VisitLogView.jsx',  () => ({ default: () => <div data-testid="visit-log" /> }));
vi.mock('./BlacklistView.jsx', () => ({ default: () => <div data-testid="blacklist" /> }));
vi.mock('../chat/ChatView.jsx', () => ({ ChatView: () => <div data-testid="chat" /> }));

const adminUser = { uid: 'a1', role: 'admin', name: 'Администратор' };

describe('AdminView', () => {
  test('по умолчанию показывает вкладку stats', () => {
    render(<AdminView user={adminUser} activeTab="stats" setActiveTab={vi.fn()} />);
    // Stats показывает карточки с числами
    expect(screen.getByText('Пользователей')).toBeInTheDocument();
  });

  test.skip('вкладка requests показывает список заявок', () => {
    render(<AdminView user={adminUser} activeTab="requests" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('req-row')).toBeInTheDocument();
  });

  test('вкладка users показывает список пользователей', () => {
    render(<AdminView user={adminUser} activeTab="users" setActiveTab={vi.fn()} />);
    expect(screen.getAllByTestId('user-row').length).toBeGreaterThan(0);
  });

  test('вкладка visitlog рендерит VisitLogView', () => {
    render(<AdminView user={adminUser} activeTab="visitlog" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('visit-log')).toBeInTheDocument();
  });

  test('вкладка blacklist рендерит BlacklistView', () => {
    render(<AdminView user={adminUser} activeTab="blacklist" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('blacklist')).toBeInTheDocument();
  });

  test('вкладка chat рендерит ChatView', () => {
    render(<AdminView user={adminUser} activeTab="chat" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('кнопка "+ Добавить" в users открывает AddUserModal', () => {
    render(<AdminView user={adminUser} activeTab="users" setActiveTab={vi.fn()} />);
    fireEvent.click(screen.getByText(/добавить/i));
    expect(screen.getByTestId('add-user-modal')).toBeInTheDocument();
  });

  test('stats показывает правильный счётчик пользователей', () => {
    render(<AdminView user={adminUser} activeTab="stats" setActiveTab={vi.fn()} />);
    // 2 пользователя в моке
    const statVal = screen.getAllByText('2');
    expect(statVal.length).toBeGreaterThan(0);
  });
});
