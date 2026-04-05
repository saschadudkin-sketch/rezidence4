/**
 * views/GuardPostMode.test.js
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import GuardPostMode from './GuardPostMode';
import * as AppStore from '../store/AppStore';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mkReq = (overrides={}) => ({
  id:'r1', type:'pass', status:'pending', category:'guest',
  visitorName:'Гость', visitorPhone:'+79001234567', carPlate:null, comment:'',
  passDuration:'once', validUntil:null, createdByUid:'u1',
  createdByName:'Иван', createdByRole:'owner', createdByApt:'12',
  createdAt: new Date().toISOString(), arrivedAt:null, photos:[],
  ...overrides,
});

vi.mock('../ui/AvatarCircle',            () => ({ AvatarCircle: () => null }));
vi.mock('../requests/PassQRModal',       () => ({ PassQRModal: () => null }));
vi.mock('../store/slices/blacklistSlice',() => ({ checkBlacklist: () => null }));
vi.mock('../ui/Toasts',                  () => ({ toast: vi.fn() }));
vi.mock('../requests/ScanQRModal',       () => ({ ScanQRModal: () => null }));
vi.mock('../services/pushNotification',  () => ({ pushNotifyResident: vi.fn() }));
vi.mock('../shared/api/passesApi',       () => ({ logVisit: vi.fn().mockResolvedValue({}) }));
vi.mock('../utils', () => ({ sortReqs: v => v, playAlert: vi.fn(), sendNotif: vi.fn() }));
vi.mock('../utils', () => ({ sortReqs: v => v, playAlert: vi.fn(), sendNotif: vi.fn() }));


beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue([mkReq()]);
  vi.spyOn(AppStore, 'useActions').mockReturnValue({
    approveRequest: vi.fn(), rejectRequest: vi.fn(),
    arriveRequest: vi.fn(), approveAndArrive: vi.fn(),
  });
  vi.spyOn(AppStore, 'useBlacklist').mockReturnValue([]);
  vi.spyOn(AppStore, 'useUsers').mockReturnValue({ users: { u1: { uid:'u1', name:'Иван', role:'owner', phone:'+7' } } });
  vi.spyOn(AppStore, 'useAvatar').mockReturnValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe('GuardPostMode', () => {
  const user = { uid:'g1', role:'security', name:'Охрана' };

  test('рендерится без ошибок', () => {
    expect(() => render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={vi.fn()} />)).not.toThrow();
  });

  test('показывает карточку заявки', () => {
    render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={vi.fn()} />);
    expect(screen.getAllByText('Гость').length).toBeGreaterThan(0);
  });

  test('показывает вкладки "Активные" и "Временные"', () => {
    render(<GuardPostMode user={user} highlightReqId={null} setHighlightReqId={vi.fn()} />);
    expect(screen.getByRole('button', { name: /активные/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /временные/i })).toBeInTheDocument();
  });
});

// FIX [BUG-2, 5, 17, 19]: Structural checks on guard sub-components
// Компоненты GuardCard, TempPassCard, TechCard вынесены в views/guard/
describe('GuardPostMode audit fixes', () => {
  const readGuard = (name) => {
    const fs = require('fs');
    return fs.readFileSync(require.resolve('./guard/' + name), 'utf8');
  };

  test('FIX BUG-5: GuardCard обёрнут в memo', () => {
    expect(readGuard('GuardCard.tsx')).toMatch(/const GuardCard = memo/);
  });

  test('FIX BUG-5: TempPassCard обёрнут в memo', () => {
    expect(readGuard('TempPassCard.tsx')).toMatch(/const TempPassCard = memo/);
  });

  test('FIX BUG-5: TechCard обёрнут в memo', () => {
    expect(readGuard('TechCard.tsx')).toMatch(/const TechCard = memo/);
  });

  test('FIX BUG-2: нет fire-and-forget setTimeout(async) в TempPassCard', () => {
    // Убрали setTimeout(async → теперь прямой async/await
    const src = readGuard('TempPassCard.tsx').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/setTimeout\(async/);
  });

  test('FIX BUG-2: isMountedRef присутствует в TempPassCard', () => {
    expect(readGuard('TempPassCard.tsx')).toContain('isMountedRef');
  });

  test('FIX BUG-17: window.open заменён на <a rel=noopener>', () => {
    const src = readGuard('GuardCard.tsx').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('window.open');
    expect(src).toContain('rel="noopener noreferrer"');
  });

  test('FIX BUG-6: стабильный ключ key={i} для фото (не src.slice)', () => {
    const src = readGuard('GuardCard.tsx').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/key=\{src\.slice/);
  });
});
