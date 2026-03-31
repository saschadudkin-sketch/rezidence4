/**
 * views/ResidentView.test.js
 * Smoke + ключевые сценарии
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ResidentView from './ResidentView.jsx';
import * as AppStore from '../store/AppStore.jsx';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const baseReq = (overrides = {}) => ({
  id: 'r1', type: 'pass', status: 'pending', category: 'guest',
  visitorName: 'Гость', visitorPhone: '+79001234567', carPlate: null,
  comment: '', passDuration: 'once', validUntil: null, scheduledFor: null,
  createdByUid: 'u1', createdByName: 'Иван', createdByRole: 'owner', createdByApt: '12',
  createdAt: new Date().toISOString(), arrivedAt: null, photos: [],
  ...overrides,
});

vi.mock('../config/runtimeMode.js', () => ({ isLiveMode: () => false }));
vi.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { deleteEverywhere: vi.fn().mockResolvedValue('local'), updateEverywhere: vi.fn().mockResolvedValue('local') } },
}));
vi.mock('../ui/Toasts.jsx', () => ({ toast: vi.fn() }));
vi.mock('../domain/permissions', () => ({
  ROLES: { CONTRACTOR: 'contractor' },
  can: () => ({ editRequest: () => false, deleteRequest: () => true, repeatRequest: () => false }),
  isResident: () => true,
}));
vi.mock('../requests/ReqCard.jsx', () => ({
  GroupedReqList: ({ reqs }) => <div data-testid="req-list">{reqs.length} заявок</div>,
}));
vi.mock('../requests/CreateModal.jsx',      () => ({ CreateModal:      () => <div data-testid="create-modal" /> }));
vi.mock('../requests/EditRequestModal.jsx', () => ({ EditRequestModal: () => <div data-testid="edit-modal" /> }));
vi.mock('../perms/PermsList.jsx',           () => ({ PermsList: () => <div data-testid="perms-list" />, MyTemplates: () => null }));
vi.mock('../chat/ChatView.jsx',             () => ({ ChatView: () => <div data-testid="chat" /> }));
vi.mock('./GarageView.jsx',                 () => ({ default: () => <div data-testid="garage" /> }));

const user = { uid: 'u1', role: 'owner', name: 'Иван' };

beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue([baseReq()]);
  vi.spyOn(AppStore, 'useActions').mockReturnValue({
    deleteRequest: vi.fn(),
    updateRequest: vi.fn(),
  });
});

afterEach(() => vi.restoreAllMocks());

describe('ResidentView', () => {
  test('показывает список заявок на вкладке passes', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('req-list')).toBeInTheDocument();
  });

  test('вкладка perms рендерит PermsList', () => {
    render(<ResidentView user={user} activeTab="perms" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('perms-list')).toBeInTheDocument();
  });

  test('вкладка chat рендерит ChatView', () => {
    render(<ResidentView user={user} activeTab="chat" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('на вкладке passes отображаются карточки типов пропуска', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);
    expect(screen.getByText('Гость')).toBeInTheDocument();
    expect(screen.getByText('Курьер')).toBeInTheDocument();
  });

  test('клик по карточке типа открывает CreateModal', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);
    fireEvent.click(screen.getByText('Гость'));
    expect(screen.getByTestId('create-modal')).toBeInTheDocument();
  });
});
