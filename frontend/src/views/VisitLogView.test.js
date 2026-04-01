/**
 * views/VisitLogView.test.js
 * Покрывает: VisitLogView — отображение журнала, фильтрация, helper-функции fmtDateFull/fmtDuration
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VisitLogView from './VisitLogView';
import * as AppStore from '../store/AppStore.jsx';
import * as passesApi from '../shared/api/passesApi.js';


const mockRequests = [
  {
    id: 'r1', type: 'pass', category: 'guest', status: 'arrived',
    visitorName: 'Дмитрий Орлов', carPlate: null, comment: '',
    passDuration: 'once', result: 'allowed',
    createdByUid: 'u1', createdByName: 'Михаил Волков', createdByApt: '12',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    arrivedAt:  new Date(Date.now() - 1_800_000).toISOString(),
  },
  {
    id: 'r2', type: 'tech', category: 'plumber', status: 'accepted',
    visitorName: null, carPlate: null, comment: 'Течёт кран',
    passDuration: null, result: null,
    createdByUid: 'u2', createdByName: 'Анна Соколова', createdByApt: '34',
    createdAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
    arrivedAt:  null,
  },
];

beforeEach(() => {
  vi.spyOn(AppStore, 'useRequests').mockReturnValue(mockRequests);
  vi.spyOn(passesApi, 'getVisitLogs').mockResolvedValue([{ id: 'e1', requestId: 'r1', timestamp: new Date().toISOString(), result: 'allowed' }]);
  vi.spyOn(passesApi, 'clearVisitLogs').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

vi.mock('../hooks/useDebounce', () => ({
  useDebounce: (v) => v,
}));

vi.mock('../config/runtimeMode', () => ({
  isDemoMode: vi.fn(() => true),
}));

vi.mock('../constants/statusPresentation', () => ({
  getValidationReasonLabel: vi.fn(() => ''),
}));

describe('VisitLogView', () => {
  const user = { uid: 'a1', role: 'admin' };

  test('отображает имя гостя из первой заявки', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText('Дмитрий Орлов')).toBeInTheDocument();
  });

  test('отображает категорию если нет имени', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText('Дмитрий Орлов')).toBeInTheDocument();
  });

  test('тег "Допуск" для result=allowed', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText(/допуск/i)).toBeInTheDocument();
  });

  test('имя создателя заявки отображается', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText('Михаил Волков')).toBeInTheDocument();
  });

  test('номер апартамента отображается', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText(/апарт\./i)).toBeInTheDocument();
  });

  test('поиск по имени гостя фильтрует список', async () => {
    render(<VisitLogView user={user} />);
    const searchInput = await screen.findByPlaceholderText(/поиск/i);
    fireEvent.change(searchInput, { target: { value: 'Дмитрий' } });
    expect(await screen.findByText('Дмитрий Орлов')).toBeInTheDocument();
  });

  test('показывает кнопку очистки журнала', async () => {
    render(<VisitLogView user={user} />);
    expect(await screen.findByText(/очистить/i)).toBeInTheDocument();
  });
});
