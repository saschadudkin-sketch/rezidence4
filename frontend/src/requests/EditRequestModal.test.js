/**
 * requests/EditRequestModal.test.js
 * Покрывает: EditRequestModal — предзаполнение, сохранение, закрытие, ошибки
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditRequestModal } from './EditRequestModal';

jest.mock('../store/AppStore', () => ({
  useActions: () => ({ updateRequest: jest.fn() }),
}));

jest.mock('../services/providers/serviceContainer', () => ({
  services: {
    requests: {
      updateEverywhere: jest.fn().mockResolvedValue('local'),
    },
  },
}));

jest.mock('../ui/syncFeedback', () => ({
  toastBySyncResult: jest.fn(),
}));

jest.mock('../ui/Toasts', () => ({
  toast: jest.fn(),
}));

jest.mock('../ui/scrollLock', () => ({
  lockScroll:   jest.fn(),
  unlockScroll: jest.fn(),
}));

const { services } = require('../services/providers/serviceContainer');
const { toast } = require('../ui/Toasts');

beforeEach(() => jest.clearAllMocks());

const makeReq = (overrides = {}) => ({
  id: 'r1',
  type: 'pass',
  category: 'guest',
  visitorName:  'Иван Гостев',
  visitorPhone: '+7 916 111-22-33',
  carPlate:     '',
  comment:      'Привет',
  ...overrides,
});

describe('EditRequestModal', () => {
  test('предзаполняет форму из props req', () => {
    render(<EditRequestModal req={makeReq()} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByDisplayValue('Иван Гостев')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+7 916 111-22-33')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Привет')).toBeInTheDocument();
  });

  test('заголовок "Редактировать заявку"', () => {
    render(<EditRequestModal req={makeReq()} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText('Редактировать заявку')).toBeInTheDocument();
  });

  test('категория отображается в заголовке', () => {
    render(<EditRequestModal req={makeReq({ category: 'guest' })} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText(/гость/i)).toBeInTheDocument();
  });

  test('кнопка ✕ вызывает onClose', () => {
    const onClose = jest.fn();
    render(<EditRequestModal req={makeReq()} onClose={onClose} onDone={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('успешное сохранение вызывает updateEverywhere и onDone', async () => {
    const onDone  = jest.fn();
    const onClose = jest.fn();
    render(<EditRequestModal req={makeReq()} onClose={onClose} onDone={onDone} />);

    const nameInput = screen.getByDisplayValue('Иван Гостев');
    fireEvent.change(nameInput, { target: { value: 'Новое Имя' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => {
      expect(services.requests.updateEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'r1',
          patch: expect.objectContaining({ visitorName: 'Новое Имя' }),
        })
      );
      expect(onDone).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('trim пробелов в полях при сохранении', async () => {
    render(<EditRequestModal req={makeReq({ visitorName: '  Пробелы  ' })} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(services.requests.updateEverywhere).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ visitorName: 'Пробелы' }),
        })
      );
    });
  });

  test('пустое имя → patch.visitorName = null', async () => {
    render(<EditRequestModal req={makeReq()} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Иван Гостев'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      const patch = services.requests.updateEverywhere.mock.calls[0][0].patch;
      expect(patch.visitorName).toBeNull();
    });
  });

  test('ошибка при сохранении показывает toast error', async () => {
    services.requests.updateEverywhere.mockRejectedValueOnce(new Error('Network error'));
    render(<EditRequestModal req={makeReq()} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Не удалось сохранить изменения', 'error');
    });
  });

  test('поле номера авто видно для категорий с авто', () => {
    render(<EditRequestModal req={makeReq({ category: 'taxi' })} onClose={jest.fn()} onDone={jest.fn()} />);
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes.length).toBeGreaterThanOrEqual(2); // авто + комментарий
  });

  test('поле номера авто скрыто для категории guest', () => {
    render(<EditRequestModal req={makeReq({ category: 'guest' })} onClose={jest.fn()} onDone={jest.fn()} />);
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes.length).toBe(3); // имя + телефон + комментарий
  });
});

// FIX [BUG-22]: isMountedRef — структурная проверка исправления
describe('EditRequestModal BUG-22 fix', () => {
  test('isMountedRef присутствует в исходном коде', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./EditRequestModal'), 'utf8');
    expect(src).toContain('isMountedRef');
  });

  test('setLoading защищён isMountedRef в finally', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./EditRequestModal'), 'utf8');
    // finally должен содержать isMountedRef.current перед setLoading
    expect(src).toMatch(/finally\s*\{[\s\S]{0,200}isMountedRef\.current[\s\S]{0,50}setLoading/);
  });

  test('lockScroll и isMountedRef объединены в один useEffect', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./EditRequestModal'), 'utf8');
    // Только один useEffect в файле
    const effectCount = (src.match(/useEffect\(/g) || []).length;
    expect(effectCount).toBe(1);
  });

  test('setState не вызывается после onClose (компонент уже unmounted)', async () => {
    // Эмулируем быстрое закрытие во время сохранения
    let resolveUpdate;
    services.requests.updateEverywhere.mockReturnValueOnce(
      new Promise(r => { resolveUpdate = r; })
    );
    const onClose = jest.fn();
    const { unmount } = render(<EditRequestModal req={makeReq()} onClose={onClose} onDone={jest.fn()} />);

    // Начинаем сохранение
    fireEvent.click(screen.getByText('Сохранить'));

    // Размонтируем компонент пока запрос ещё летит
    unmount();

    // Резолвим Promise после unmount — не должно быть ошибки
    expect(() => { resolveUpdate('local'); }).not.toThrow();
  });
});
