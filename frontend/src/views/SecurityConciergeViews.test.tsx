/**
 * views/SecurityConciergeViews.test.js
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConciergeView, SecurityView } from './SecurityConciergeViews';
import * as AppStore from '../store/AppStore';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const baseReq = (overrides={}) => ({
  id:'r1', type:'pass', status:'pending', category:'guest',
  visitorName:'Гость', visitorPhone:null, carPlate:null, comment:'',
  passDuration:'once', validUntil:null, scheduledFor:null,
  createdByUid:'u1', createdByName:'Иван', createdByRole:'owner', createdByApt:'12',
  createdAt: new Date().toISOString(), arrivedAt:null, photos:[],
  ...overrides,
});

vi.mock('../store/AppStore', () => ({
  useRequests:  vi.fn(() => [baseReq()]),
  useUsers:     () => ({ users: { u1: { uid:'u1', name:'Иван', role:'owner', apartment:'12', phone:'+7' } }, phoneDb: {} }),
  useAllPerms:  () => ({}),
  useActions:   () => ({ updateRequest: vi.fn(), approveRequest: vi.fn(), rejectRequest: vi.fn() }),
}));

beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue([baseReq()]);
  vi.spyOn(AppStore, 'useUsers').mockReturnValue({ users: { u1: { uid:'u1', name:'Иван', role:'owner', apartment:'12', phone:'+7' } }, phoneDb: {} });
  vi.spyOn(AppStore, 'useAllPerms').mockReturnValue({});
  vi.spyOn(AppStore, 'useActions').mockReturnValue({ updateRequest: vi.fn(), approveRequest: vi.fn(), rejectRequest: vi.fn() });
});

afterEach(() => vi.restoreAllMocks());

vi.mock('../hooks/useDebounce', () => ({ useDebounce: v => v }));
vi.mock('../utils', () => ({ sortReqs: v => v, filterByPeriod: v => v }));
vi.mock('../constants/requestPredicates', () => ({
  isPassRequest: r => r.type === 'pass',
  isTechRequest: r => r.type === 'tech',
}));
vi.mock('../requests/ReqCard',      () => ({ ReqCard: ({ req }) => <div data-testid="req-card">{req.id}</div> }));
vi.mock('../requests/CreateModal',  () => ({ CreateModal:   () => <div data-testid="create-modal" /> }));
vi.mock('../requests/ScanQRModal',  () => ({ ScanQRModal:   () => <div data-testid="scan-modal" /> }));
vi.mock('../chat/ChatView',         () => ({ ChatView:      () => <div data-testid="chat" /> }));
vi.mock('../perms/PermsList',       () => ({ MyTemplates:   () => null }));
vi.mock('./GuardPostMode',          () => ({ default: () => <div data-testid="guard-post" /> }));
vi.mock('./BlacklistView',          () => ({ default: () => <div data-testid="blacklist" /> }));
vi.mock('./VisitLogView',           () => ({ default: () => <div data-testid="visit-log" /> }));
vi.mock('./ResidentsView',          () => ({ default: () => <div data-testid="residents" /> }));
vi.mock('../requests/CarSearchModal', () => ({ CarSearchModal: () => null }));

const conciergeUser = { uid: 'c1', role: 'concierge', name: 'Консьерж' };
const securityUser  = { uid: 'g1', role: 'security',  name: 'Охрана' };

describe('ConciergeView', () => {
  test('рендерит карточки типов на вкладке passes', () => {
    render(<ConciergeView user={conciergeUser} activeTab="passes" setActiveTab={vi.fn()} />);
    expect(screen.getByText('Гость')).toBeInTheDocument();
    expect(screen.getByText('Курьер')).toBeInTheDocument();
  });

  test('рендерит ResidentsView на вкладке residents', () => {
    render(<ConciergeView user={conciergeUser} activeTab="residents" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('residents')).toBeInTheDocument();
  });

  test('рендерит ChatView на вкладке chat', () => {
    render(<ConciergeView user={conciergeUser} activeTab="chat" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('рендерит VisitLogView на вкладке visitlog', () => {
    render(<ConciergeView user={conciergeUser} activeTab="visitlog" setActiveTab={vi.fn()} />);
    expect(screen.getByTestId('visit-log')).toBeInTheDocument();
  });
});

describe('SecurityView', () => {
  test('рендерит GuardPostMode на вкладке guardpost', () => {
    render(<SecurityView user={securityUser} activeTab="guardpost" setActiveTab={vi.fn()} highlightReqId={null} setHighlightReqId={vi.fn()} />);
    expect(screen.getByTestId('guard-post')).toBeInTheDocument();
  });

  test('рендерит BlacklistView на вкладке blacklist', () => {
    render(<SecurityView user={securityUser} activeTab="blacklist" setActiveTab={vi.fn()} highlightReqId={null} setHighlightReqId={vi.fn()} />);
    expect(screen.getByTestId('blacklist')).toBeInTheDocument();
  });

  test('рендерит ChatView на вкладке chat', () => {
    render(<SecurityView user={securityUser} activeTab="chat" setActiveTab={vi.fn()} highlightReqId={null} setHighlightReqId={vi.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });
});
