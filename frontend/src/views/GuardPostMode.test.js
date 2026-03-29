/**
 * views/GuardPostMode.test.js
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import GuardPostMode from './GuardPostMode';
import * as AppStore from '../store/AppStore.jsx';

const mkReq = (overrides={}) => ({
  id:'r1', type:'pass', status:'pending', category:'guest',
  visitorName:'Гость', visitorPhone:'+79001234567', carPlate:null, comment:'',
  passDuration:'once', validUntil:null, createdByUid:'u1',
  createdByName:'Иван', createdByRole:'owner', createdByApt:'12',
  createdAt: new Date().toISOString(), arrivedAt:null, photos:[],
  ...overrides,
});

jest.mock('../ui/AvatarCircle',            () => ({ AvatarCircle: () => null }));
jest.mock('../requests/PassQRModal',       () => ({ PassQRModal: () => null }));
jest.mock('../store/slices/blacklistSlice',() => ({ checkBlacklist: () => null }));
jest.mock('../ui/Toasts',                  () => ({ toast: jest.fn() }));
jest.mock('../requests/ScanQRModal',       () => ({ ScanQRModal: () => null }));
jest.mock('../services/pushNotification',  () => ({ pushNotifyResident: jest.fn() }));
jest.mock('../shared/api/passesApi',       () => ({ logVisit: jest.fn().mockResolvedValue({}) }));
jest.mock('../utils.js', () => ({ sortReqs: v => v, playAlert: jest.fn(), sendNotif: jest.fn() }));
jest.mock('../utils', () => ({ sortReqs: v => v, playAlert: jest.fn(), sendNotif: jest.fn() }));


beforeEach(() => {
  jest.spyOn(AppStore, 'useRequests').mockReturnValue([mkReq()]);
  jest.spyOn(AppStore, 'useActions').mockReturnValue({
    approveRequest: jest.fn(), rejectRequest: jest.fn(),
    arriveRequest: jest.fn(), approveAndArrive: jest.fn(),
  });
  jest.spyOn(AppStore, 'useBlacklist').mockReturnValue([]);
  jest.spyOn(AppStore, 'useUsers').mockReturnValue({ users: { u1: { uid:'u1', name:'Иван', role:'owner', phone:'+7' } } });
  jest.spyOn(AppStore, 'useAvatar').mockReturnValue(null);
});

afterEach(() => jest.restoreAllMocks());

describe('GuardPostMode', () => {
  const user = { uid:'g1', role:'security', name:'Охрана' };

  test('рендерится без ошибок', () => {
    expect(() => render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={jest.fn()} />)).not.toThrow();
  });

  test('показывает карточку заявки', () => {
    render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={jest.fn()} />);
    expect(screen.getAllByText('Гость').length).toBeGreaterThan(0);
  });

  test('показывает вкладки "Активные" и "Временные"', () => {
    render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={jest.fn()} />);
    expect(screen.getByRole('button', { name: /активные/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /временные/i })).toBeInTheDocument();
  });
});

// FIX [BUG-2, 5, 17, 19]: Structural checks on GuardPostMode source
describe('GuardPostMode audit fixes', () => {
  const getSource = () => {
    const fs = require('fs');
    return fs.readFileSync(require.resolve('./GuardPostMode'), 'utf8');
  };

  test('FIX BUG-5: GuardCard обёрнут в memo', () => {
    expect(getSource()).toMatch(/const GuardCard = memo/);
  });

  test('FIX BUG-5: TempPassCard обёрнут в memo', () => {
    expect(getSource()).toMatch(/const TempPassCard = memo/);
  });

  test('FIX BUG-5: TechCard обёрнут в memo', () => {
    expect(getSource()).toMatch(/const TechCard = memo/);
  });

  test('FIX BUG-2: нет fire-and-forget setTimeout(async) в TempPassCard', () => {
    // Убрали setTimeout(async → теперь прямой async/await
    const src = getSource().replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/setTimeout\(async/);
  });

  test('FIX BUG-2: isMountedRef присутствует в TempPassCard', () => {
    expect(getSource()).toContain('isMountedRef');
  });

  test('FIX BUG-17: window.open заменён на <a rel=noopener>', () => {
    const src = getSource().replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('window.open');
    expect(src).toContain('rel="noopener noreferrer"');
  });

  test('FIX BUG-6: стабильный ключ key={i} для фото (не src.slice)', () => {
    const src = getSource().replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/key=\{src\.slice/);
  });
});
