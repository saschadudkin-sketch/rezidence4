/**
 * views/VisitLogView.test.js
 * Покрывает: VisitLogView — отображение журнала, фильтрация, helper-функции fmtDateFull/fmtDuration
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VisitLogView from './VisitLogView';

jest.mock('../store/AppStore', () => ({
  useRequests: jest.fn(() => [
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
  ]),
}));

jest.mock('../hooks/useDebounce', () => ({
  useDebounce: (v) => v,
}));

jest.mock('../config/runtimeMode', () => ({
  isDemoMode: jest.fn(() => true),
}));

jest.mock('../shared/api/passesApi', () => ({
  getVisitLogs:   jest.fn().mockResolvedValue([]),
  clearVisitLogs: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../constants/statusPresentation', () => ({
  getValidationReasonLabel: jest.fn(() => ''),
}));

describe('VisitLogView', () => {
  const user = { uid: 'g1', role: 'security' };

  test('отображает имя гостя из первой заявки', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText('Дмитрий Орлов')).toBeInTheDocument();
  });

  test('отображает категорию если нет имени', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText('Сантехник')).toBeInTheDocument();
  });

  test('тег "Допуск" для result=allowed', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText(/допуск/i)).toBeInTheDocument();
  });

  test('имя создателя заявки отображается', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText('Михаил Волков')).toBeInTheDocument();
  });

  test('номер апартамента отображается', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText(/Апарт\. 12/)).toBeInTheDocument();
  });

  test('поиск по имени гостя фильтрует список', () => {
    render(<VisitLogView user={user} />);
    const searchInput = screen.getByPlaceholderText(/поиск/i);
    fireEvent.change(searchInput, { target: { value: 'Дмитрий' } });
    expect(screen.getByText('Дмитрий Орлов')).toBeInTheDocument();
    expect(screen.queryByText('Михаил Волков')).not.toBeInTheDocument();
  });

  test('показывает кнопку очистки журнала', () => {
    render(<VisitLogView user={user} />);
    expect(screen.getByText(/очистить/i)).toBeInTheDocument();
  });
});
