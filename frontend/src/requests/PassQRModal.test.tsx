import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PassQRModal } from './PassQRModal';
import { generatePassQR } from '../services/qrService';

vi.mock('../services/qrService', () => ({
  generatePassQR: vi.fn(() => 'data:image/png;base64,abc123'),
}));

vi.mock('../ui/scrollLock', () => ({
  lockScroll: vi.fn(),
  unlockScroll: vi.fn(),
}));

vi.mock('../ui/Toasts', () => ({
  toast: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

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
    render(<PassQRModal req={req} onClose={vi.fn()} />);
    expect(screen.getByText('QR-код пропуска')).toBeInTheDocument();
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
  });

  test('генерирует QR по req.id (не по всему объекту)', async () => {
    render(<PassQRModal req={req} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(generatePassQR).toHaveBeenCalledTimes(1);
    });
  });

  test('запрашивает QR-данные для отображения', async () => {
    render(<PassQRModal req={req} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(generatePassQR).toHaveBeenCalledWith(req);
    });
  });

  test('ошибка генерации QR показывает сообщение об ошибке', async () => {
    generatePassQR.mockRejectedValueOnce(new Error('QR error'));
    render(<PassQRModal req={req} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/не удалось/i)).toBeInTheDocument();
    });
  });

  test('Escape вызывает onClose', async () => {
    const onClose = vi.fn();
    render(<PassQRModal req={req} onClose={onClose} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('кнопка закрытия вызывает onClose', async () => {
    const onClose = vi.fn();
    render(<PassQRModal req={req} onClose={onClose} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('имя посетителя отображается', async () => {
    render(<PassQRModal req={req} onClose={vi.fn()} />);
    expect(screen.getByText('Иван Гостев')).toBeInTheDocument();
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
  });

  test('повторный рендер с тем же req.id не вызывает повторную генерацию QR', async () => {
    const { rerender } = render(<PassQRModal req={req} onClose={vi.fn()} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));

    rerender(<PassQRModal req={req} onClose={vi.fn()} />);
    await waitFor(() => expect(generatePassQR).toHaveBeenCalledTimes(1));
  });
});
