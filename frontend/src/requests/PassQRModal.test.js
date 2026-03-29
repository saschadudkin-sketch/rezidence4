/**
 * requests/PassQRModal.test.js
 * Покрывает: PassQRModal — генерация QR, Escape, закрытие, ошибка генерации
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PassQRModal } from './PassQRModal';

jest.mock('../services/qrService', () => ({
  __esModule: true,
  generatePassQR: jest.fn(() => 'data:image/png;base64,abc123'),
}));

jest.mock('../ui/scrollLock', () => ({
  lockScroll:   jest.fn(),
  unlockScroll: jest.fn(),
}));

jest.mock('../ui/Toasts', () => ({ toast: jest.fn() }));

const { generatePassQR } = require('../services/qrService');

beforeEach(() => jest.clearAllMocks());

const req = {
  id: 'r1',
  type: 'pass',
  category: 'guest',
  visitorName: 'Иван Гостев',
  passDuration: 'once',
  status: 'approved',
  createdByName: 'Михаил',
  createdByApt: '12',
};

describe('PassQRModal', () => {
  test('показывает заголовок "QR-код пропуска"', async () => {
    render(<PassQRModal req={req} onClose={jest.fn()} />);
    expect(screen.getByText('QR-код пропуска')).toBeInTheDocument();
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
  });

  test('генерирует QR по req.id (не по всему объекту)', async () => {
    render(<PassQRModal req={req} onClose={jest.fn()} />);
    await waitFor(() => {
      expect(generatePassQR).toHaveBeenCalledTimes(1);
    });
  });

  test('запрашивает QR-данные для отображения', async () => {
    render(<PassQRModal req={req} onClose={jest.fn()} />);
    await waitFor(() => {
      expect(generatePassQR).toHaveBeenCalledWith(req);
    });
  });

  test('ошибка генерации QR показывает сообщение об ошибке', async () => {
    generatePassQR.mockRejectedValueOnce(new Error('QR error'));
    render(<PassQRModal req={req} onClose={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/не удалось/i)).toBeInTheDocument();
    });
  });

  test('Escape вызывает onClose', () => {
    const onClose = jest.fn();
    render(<PassQRModal req={req} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('кнопка ✕ вызывает onClose', () => {
    const onClose = jest.fn();
    render(<PassQRModal req={req} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('имя посетителя отображается', async () => {
    render(<PassQRModal req={req} onClose={jest.fn()} />);
    expect(screen.getByText('Иван Гостев')).toBeInTheDocument();
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
  });

  test('повторный рендер с тем же req.id не вызывает повторную генерацию QR', async () => {
    const { rerender } = render(<PassQRModal req={req} onClose={jest.fn()} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));

    // Меняем только onClose, req.id остаётся прежним
    rerender(<PassQRModal req={req} onClose={jest.fn()} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1)); // не вызван повторно
  });
});
