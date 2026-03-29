/**
 * views/SecurityConciergeViews.test.js
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConciergeView, SecurityView } from './SecurityConciergeViews';
import * as AppStore from '../store/AppStore.jsx';

const baseReq = (overrides={}) => ({
  id:'r1', type:'pass', status:'pending', category:'guest',
  visitorName:'Гость', visitorPhone:null, carPlate:null, comment:'',
  passDuration:'once', validUntil:null, scheduledFor:null,
  createdByUid:'u1', createdByName:'Иван', createdByRole:'owner', createdByApt:'12',
  createdAt: new Date().toISOString(), arrivedAt:null, photos:[],
  ...overrides,
});

jest.mock('../store/AppStore', () => ({
  useRequests:  jest.fn(() => [baseReq()]),
  useUsers:     () => ({ users: { u1: { uid:'u1', name:'Иван', role:'owner', apartment:'12', phone:'+7' } } }),
  useAllPerms:  () => ({}),
  useActions:   () => ({ updateRequest: jest.fn(), approveRequest: jest.fn(), rejectRequest: jest.fn() }),
}));

beforeEach(() => {
  jest.spyOn(AppStore, 'useRequests').mockReturnValue([baseReq()]);
  jest.spyOn(AppStore, 'useUsers').mockReturnValue({ users: { u1: { uid:'u1', name:'Иван', role:'owner', apartment:'12', phone:'+7' } } });
  jest.spyOn(AppStore, 'useAllPerms').mockReturnValue({});
  jest.spyOn(AppStore, 'useActions').mockReturnValue({ updateRequest: jest.fn(), approveRequest: jest.fn(), rejectRequest: jest.fn() });
});

afterEach(() => jest.restoreAllMocks());

jest.mock('../hooks/useDebounce', () => ({ useDebounce: v => v }));
jest.mock('../utils', () => ({ sortReqs: v => v, filterByPeriod: v => v }));
jest.mock('../constants/requestPredicates', () => ({
  isPassRequest: r => r.type === 'pass',
  isTechRequest: r => r.type === 'tech',
}));
jest.mock('../requests/ReqCard',      () => ({ ReqCard: ({ req }) => <div data-testid="req-card">{req.id}</div> }));
jest.mock('../requests/CreateModal',  () => ({ CreateModal:   () => <div data-testid="create-modal" /> }));
jest.mock('../requests/ScanQRModal',  () => ({ ScanQRModal:   () => <div data-testid="scan-modal" /> }));
jest.mock('../chat/ChatView',         () => ({ ChatView:      () => <div data-testid="chat" /> }));
jest.mock('../perms/PermsList',       () => ({ MyTemplates:   () => null }));
jest.mock('./GuardPostMode',          () => () => <div data-testid="guard-post" />);
jest.mock('./BlacklistView',          () => () => <div data-testid="blacklist" />);
jest.mock('./VisitLogView',           () => () => <div data-testid="visit-log" />);
jest.mock('./ResidentsView',          () => () => <div data-testid="residents" />);
jest.mock('../requests/CarSearchModal', () => ({ CarSearchModal: () => null }));

const conciergeUser = { uid: 'c1', role: 'concierge', name: 'Консьерж' };
const securityUser  = { uid: 'g1', role: 'security',  name: 'Охрана' };

describe('ConciergeView', () => {
  test('рендерит карточки типов на вкладке passes', () => {
    render(<ConciergeView user={conciergeUser} activeTab="passes" setActiveTab={jest.fn()} />);
    expect(screen.getByText('Гость')).toBeInTheDocument();
    expect(screen.getByText('Курьер')).toBeInTheDocument();
  });

  test('рендерит ResidentsView на вкладке residents', () => {
    render(<ConciergeView user={conciergeUser} activeTab="residents" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('residents')).toBeInTheDocument();
  });

  test('рендерит ChatView на вкладке chat', () => {
    render(<ConciergeView user={conciergeUser} activeTab="chat" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  test('рендерит VisitLogView на вкладке visitlog', () => {
    render(<ConciergeView user={conciergeUser} activeTab="visitlog" setActiveTab={jest.fn()} />);
    expect(screen.getByTestId('visit-log')).toBeInTheDocument();
  });
});

describe('SecurityView', () => {
  test('рендерит GuardPostMode на вкладке guardpost', () => {
    render(<SecurityView user={securityUser} activeTab="guardpost" setActiveTab={jest.fn()} highlightReqId={null} setHighlightReqId={jest.fn()} />);
    expect(screen.getByTestId('guard-post')).toBeInTheDocument();
  });

  test('рендерит BlacklistView на вкладке blacklist', () => {
    render(<SecurityView user={securityUser} activeTab="blacklist" setActiveTab={jest.fn()} highlightReqId={null} setHighlightReqId={jest.fn()} />);
    expect(screen.getByTestId('blacklist')).toBeInTheDocument();
  });

  test('рендерит ChatView на вкладке chat', () => {
    render(<SecurityView user={securityUser} activeTab="chat" setActiveTab={jest.fn()} highlightReqId={null} setHighlightReqId={jest.fn()} />);
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });
});
