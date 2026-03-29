/**
 * views/admin/AdminReqRow.test.js
 * Покрывает: AdminReqRow — рендер, кнопки ред./удаление, синхронизация из props
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReqRow from './AdminReqRow';

// Мокируем все зависимости компонента
jest.mock('../../store/AppStore', () => ({
  useActions: () => ({
    deleteRequest: jest.fn(),
    updateRequest: jest.fn(),
  }),
}));

jest.mock('../../services/providers/serviceContainer', () => ({
  services: {
    requests: {
      deleteEverywhere: jest.fn().mockResolvedValue('local'),
      updateEverywhere: jest.fn().mockResolvedValue('local'),
    },
  },
}));

jest.mock('../../ui/syncFeedback', () => ({
  toastBySyncResult: jest.fn(),
}));

jest.mock('../../ui/Toasts', () => ({
  toast: jest.fn(),
}));

jest.mock('../../requests/ReqCard', () => ({
  ReqCard: ({ req }) => <div data-testid="req-card">{req.status}</div>,
}));

const makeReq = (overrides = {}) => ({
  id: 'r1',
  type: 'pass',
  status: 'pending',
  comment: 'Тест',
  createdByUid: 'u1',
  createdByName: 'Иван',
  createdByRole: 'owner',
  category: 'guest',
  visitorName: 'Гость',
  createdAt: new Date().toISOString(),
  ...overrides,
});

const { services } = require('../../services/providers/serviceContainer');
const { toast } = require('../../ui/Toasts');

beforeEach(() => jest.clearAllMocks());

describe('AdminReqRow', () => {
  test('рендерит ReqCard с текущим статусом', () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    expect(screen.getByTestId('req-card')).toHaveTextContent('pending');
  });

  test('показывает кнопки "Ред." и "Удалить"', () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    expect(screen.getByText('✏️ Ред.')).toBeInTheDocument();
    expect(screen.getByText('🗑 Удалить')).toBeInTheDocument();
  });

  test('клик на "Ред." открывает форму редактирования', () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    fireEvent.click(screen.getByText('✏️ Ред.'));
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Отмена')).toBeInTheDocument();
  });

  test('кнопка "✕" в режиме редактирования закрывает форму', () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    fireEvent.click(screen.getByText('✏️ Ред.'));
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Отмена'));
    expect(screen.queryByText('Сохранить')).not.toBeInTheDocument();
  });

  test('клик "Удалить" вызывает deleteEverywhere', async () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    fireEvent.click(screen.getByText('🗑 Удалить'));
    await waitFor(() => {
      expect(services.requests.deleteEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'r1' })
      );
    });
  });

  test('ошибка при удалении показывает toast error', async () => {
    services.requests.deleteEverywhere.mockRejectedValueOnce(new Error('Сбой'));
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    fireEvent.click(screen.getByText('🗑 Удалить'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Ошибка удаления', 'error');
    });
  });

  test('FIX BUG: статус синхронизируется из props когда не редактируется', () => {
    const { rerender } = render(<AdminReqRow r={makeReq({ status: 'pending' })} adminUid="a1" />);
    // Обновляем props — компонент не в режиме редактирования
    rerender(<AdminReqRow r={makeReq({ status: 'approved' })} adminUid="a1" />);
    // ReqCard должна получить новый статус
    expect(screen.getByTestId('req-card')).toHaveTextContent('approved');
  });

  test('статус НЕ синхронизируется из props пока идёт редактирование', () => {
    const { rerender } = render(<AdminReqRow r={makeReq({ status: 'pending' })} adminUid="a1" />);
    fireEvent.click(screen.getByText('✏️ Ред.')); // открываем редактирование
    // Обновляем props снаружи
    rerender(<AdminReqRow r={makeReq({ status: 'approved' })} adminUid="a1" />);
    // ReqCard всё ещё показывает старый статус (форма не обновилась)
    const reqCard = screen.getByTestId('req-card');
    // В режиме редактирования отображаем локальный status из state (pending)
    expect(reqCard).toHaveTextContent('pending');
  });

  test('сохранение вызывает updateEverywhere с patch', async () => {
    render(<AdminReqRow r={makeReq()} adminUid="a1" />);
    fireEvent.click(screen.getByText('✏️ Ред.'));

    const commentInput = screen.getByPlaceholderText('Комментарий');
    fireEvent.change(commentInput, { target: { value: 'Новый комментарий' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => {
      expect(services.requests.updateEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'r1',
          patch: expect.objectContaining({ comment: 'Новый комментарий' }),
        })
      );
    });
  });
});
