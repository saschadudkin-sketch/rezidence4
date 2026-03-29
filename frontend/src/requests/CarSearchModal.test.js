/**
 * requests/CarSearchModal.test.js
 * Покрывает: CarSearchModal — поиск авто по номеру, результаты, Escape, минимум 2 символа
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CarSearchModal } from './CarSearchModal';

jest.mock('../store/AppStore', () => ({
  useUsers: () => ({
    users: {
      u1: { uid: 'u1', name: 'Иван Петров',   role: 'owner',  phone: '+7 916 123-45-67', apartment: '12', parkingSpot: 'А1' },
      u2: { uid: 'u2', name: 'Анна Соколова', role: 'tenant', phone: '+7 929 234-56-78', apartment: '34', parkingSpot: null },
      g1: { uid: 'g1', name: 'Охранник',      role: 'security', phone: '+7 917 000-00-00', apartment: null, parkingSpot: null },
    },
  }),
  useAllGarage: () => ({
    u1: [{ id: 'car1', plate: 'А123ВС77', brand: 'BMW',  isMain: true }],
    u2: [{ id: 'car2', plate: 'В456ГД78', brand: 'Kia',  isMain: false }],
    g1: [], // охранник — не резидент, не должен попасть в поиск
  }),
}));

jest.mock('../ui/scrollLock', () => ({
  lockScroll:   jest.fn(),
  unlockScroll: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

describe('CarSearchModal', () => {
  test('рендерится с заголовком', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    expect(screen.getByText(/поиск по номеру авто/i)).toBeInTheDocument();
  });

  test('показывает подсказку "минимум 2 символа" при пустом вводе', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    expect(screen.getByText(/минимум 2 символа/i)).toBeInTheDocument();
  });

  test('показывает подсказку при 1 символе', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А' } });
    expect(screen.getByText(/минимум 2 символа/i)).toBeInTheDocument();
  });

  test('находит авто по 2+ символам', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А1' } });
    expect(screen.getByText('А123ВС77')).toBeInTheDocument();
  });

  test('показывает апартамент жильца в результатах', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А1' } });
    expect(screen.getByText(/Апарт\. 12/)).toBeInTheDocument();
  });

  test('показывает парковочное место если задано', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А1' } });
    expect(screen.getByText(/А1/)).toBeInTheDocument(); // parkingSpot
  });

  test('показывает марку авто', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А1' } });
    expect(screen.getByText('BMW')).toBeInTheDocument();
  });

  test('не показывает авто охраны (не резидент)', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А' } });
    expect(screen.queryByText('Охранник')).not.toBeInTheDocument();
  });

  test('показывает "не найдено" при отсутствии совпадений', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'ХХ99' } });
    expect(screen.getByText(/не найден/i)).toBeInTheDocument();
  });

  test('ввод приводится к верхнему регистру', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    const input = screen.getByPlaceholderText(/номер/i);
    fireEvent.change(input, { target: { value: 'а123' } });
    expect(input.value).toBe('А123');
  });

  test('Escape вызывает onClose', () => {
    const onClose = jest.fn();
    render(<CarSearchModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('кнопка "Закрыть" вызывает onClose', () => {
    const onClose = jest.fn();
    render(<CarSearchModal onClose={onClose} />);
    fireEvent.click(screen.getByText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('поиск частичный — "23ВС" находит А123ВС77', () => {
    render(<CarSearchModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: '23ВС' } });
    expect(screen.getByText('А123ВС77')).toBeInTheDocument();
  });
});
