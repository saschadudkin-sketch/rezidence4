import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ResidentView from './ResidentView';
import * as AppStore from '../store/AppStore';

const baseReq = (overrides = {}) => ({
  id: 'r1',
  type: 'pass',
  status: 'pending',
  category: 'guest',
  visitorName: 'Гость',
  visitorPhone: '+79001234567',
  carPlate: null,
  comment: '',
  passDuration: 'once',
  validUntil: null,
  scheduledFor: null,
  createdByUid: 'u1',
  createdByName: 'Иван',
  createdByRole: 'owner',
  createdByApt: '12',
  createdAt: new Date().toISOString(),
  arrivedAt: null,
  photos: [],
  ...overrides,
});

vi.mock('../config/runtimeMode', () => ({ isLiveMode: () => false }));
vi.mock('../services/providers/serviceContainer', () => ({
  services: {
    requests: {
      deleteEverywhere: vi.fn().mockResolvedValue('local'),
      updateEverywhere: vi.fn().mockResolvedValue('local'),
    },
  },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../domain/permissions', () => ({
  ROLES: { CONTRACTOR: 'contractor' },
  can: () => ({ editRequest: () => false, deleteRequest: () => true, repeatRequest: () => false }),
  isResident: () => true,
}));
vi.mock('../requests/ReqCard', () => ({
  GroupedReqList: ({ reqs }: { reqs: Array<{ id: string }> }) => <div data-testid="req-list">{reqs.length} заявок</div>,
  ReqCard: ({ req }: { req: { id: string } }) => <div data-testid="req-card">{req.id}</div>,
}));
vi.mock('../requests/CreateModal', () => ({ CreateModal: () => <div data-testid="create-modal" /> }));
vi.mock('../requests/EditRequestModal', () => ({ EditRequestModal: () => <div data-testid="edit-modal" /> }));
vi.mock('../perms/PermsList', () => ({ PermsList: () => <div data-testid="perms-list" />, MyTemplates: () => null }));
vi.mock('../chat/ChatView', () => ({ ChatView: () => <div data-testid="chat" /> }));
vi.mock('./GarageView', () => ({ default: () => <div data-testid="garage" /> }));

const user = { uid: 'u1', role: 'owner', name: 'Иван' };

beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue([baseReq()]);
  vi.spyOn(AppStore, 'useActions').mockReturnValue({
    deleteRequest: vi.fn(),
    updateRequest: vi.fn(),
    addRequest: vi.fn(),
  });
});

afterEach(() => vi.restoreAllMocks());

describe('ResidentView', () => {
  test('renders owner passes shortcuts and CTA', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);

    const typeGrid = document.querySelector('.type-grid');
    expect(typeGrid).not.toBeNull();

    expect(within(typeGrid as HTMLElement).getByRole('button', { name: 'Гость' })).toBeInTheDocument();
    expect(within(typeGrid as HTMLElement).getByRole('button', { name: 'Курьер' })).toBeInTheDocument();
  });

  test('renders perms tab', () => {
    render(<ResidentView user={user} activeTab="perms" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('perms-list')).toBeInTheDocument();
  });

  test('renders chat tab', () => {
    render(<ResidentView user={user} activeTab="chat" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('shows current request content on passes tab', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);
    expect(screen.getAllByText('Гость')).not.toHaveLength(0);
    expect(screen.getByText('Разовые (1)')).toBeInTheDocument();
  });

  test('opens CreateModal after selecting a category card', () => {
    render(<ResidentView user={user} activeTab="passes" setActiveTab={vi.fn()} />);

    const typeGrid = document.querySelector('.type-grid');
    expect(typeGrid).not.toBeNull();

    fireEvent.click(within(typeGrid as HTMLElement).getByRole('button', { name: 'Гость' }));
    expect(screen.getByTestId('create-modal')).toBeInTheDocument();
  });
});
