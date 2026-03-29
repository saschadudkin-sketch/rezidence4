/**
 * views/ResidentView.test.js
 * Smoke + ключевые сценарии
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ResidentView from './ResidentView';
import * as AppStore from '../store/AppStore.jsx';

const baseReq = (overrides = {}) => ({
  id: 'r1', type: 'pass', status: 'pending', category: 'guest',
  visitorName: 'Гость', visitorPhone: '+79001234567', carPlate: null,
  comment: '', passDuration: 'once', validUntil: null, scheduledFor: null,
  createdByUid: 'u1', createdByName: 'Иван', createdByRole: 'owner', createdByApt: '12',
  createdAt: new Date().toISOString(), arrivedAt: null, photos: [],
  ...overrides,
});

jest.mock('../config/runtimeMode', () => ({ isLiveMode: () => false }));
jest.mock('../services/providers/serviceContainer', () => ({
  services: { requests: { deleteEverywhere: jest.fn().mockResolvedValue('local'), updateEverywhere: jest.fn().mockResolvedValue('local') } },
}));
jest.mock('../ui/Toasts', () => ({ toast: jest.fn() }));
jest.mock('../domain/permissions', () => ({
  ROLES: { CONTRACTOR: 'contractor' },
  can: () => ({ editRequest: () => false, deleteRequest: () => true, repeatRequest: () => false }),
  isResident: () => true,
}));
jest.mock('../requests/ReqCard', () => ({
  GroupedReqList: ({ reqs }) => <div data-testid="req-list">{reqs.length} заявок</div>,
}));
jest.mock('../requests/CreateModal',      () => ({ CreateModal:      () => <div data-testid="create-modal" /> }));
jest.mock('../requests/EditRequestModal', () => ({ EditRequestModal: () => <div data-testid="edit-modal" /> }));
jest.mock('../perms/PermsList',           () => ({ PermsList: () => <div data-testid="perms-list" />, MyTemplates: () => null }));
jest.mock('../chat/ChatView',             () => ({ ChatView: () => <div data-testid="chat" /> }));
jest.mock('./GarageView',                 () => () => <div data-testid="garage" />);

const user = { uid: 'u1', role: 'owner', name: 'Иван' };

beforeEach(() => {
  jest.spyOn(AppStore, 'useRequests').mockReturnValue([baseReq()]);
  jest.spyOn(AppStore, 'useActions').mockReturnValue({
    deleteRequest: jest.fn(),
    updateRequest: jest.fn(),
  });
});

afterEach(() => jest.restoreAllMocks());

describe('ResidentView', () => {
  test('показывает список заявок на вкладке passes', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('req-list')).toBeInTheDocument();
  });

  test('вкладка perms рендерит PermsList', () => {
    render(<ResidentView user={user} activeTab="perms" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('perms-list')).toBeInTheDocument();
  });

  test('вкладка chat рендерит ChatView', () => {
    render(<ResidentView user={user} activeTab="chat" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('на вкладке passes отображаются карточки типов пропуска', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={jest.fn()} />);
    expect(screen.getByText('Гость')).toBeInTheDocument();
    expect(screen.getByText('Курьер')).toBeInTheDocument();
  });

  test('клик по карточке типа открывает CreateModal', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={jest.fn()} />);
    fireEvent.click(screen.getByText('Гость'));
    expect(screen.getByTestId('create-modal')).toBeInTheDocument();
  });
});
