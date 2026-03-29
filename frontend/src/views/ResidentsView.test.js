/**
 * views/ResidentsView.test.js
 * Покрывает: ResidentsView — группировка по апартаментам, поиск, раскрытие карточки
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ResidentsView from './ResidentsView';

jest.mock('../store/AppStore', () => ({
  useUsers: () => ({
    users: {
      u1: { uid: 'u1', name: 'Иван Петров',   role: 'owner',  phone: '+7 916 100-00-01', apartment: '12', parkingSpot: 'А1' },
      u2: { uid: 'u2', name: 'Анна Соколова', role: 'tenant', phone: '+7 929 200-00-02', apartment: '34', parkingSpot: null },
      u3: { uid: 'u3', name: 'Пётр Орлов',    role: 'owner',  phone: '+7 903 300-00-03', apartment: '12', parkingSpot: null },
      g1: { uid: 'g1', name: 'Охранник',      role: 'security', phone: '+7 917 000-00-00', apartment: null },
    },
  }),
  useAllGarage: () => ({
    u1: [{ id: 'car1', plate: 'А123ВС77', brand: 'BMW', isMain: true }],
    u2: [],
    u3: [],
    g1: [],
  }),
}));

jest.mock('../hooks/useDebounce', () => ({
  useDebounce: (v) => v, // сразу возвращает значение
}));

jest.mock('../ui/AvatarCircle', () => ({
  AvatarCircle: ({ name }) => <span data-testid="avatar">{name[0]}</span>,
}));

describe('ResidentsView', () => {
  const user = { uid: 'g1', role: 'security' };

  test('показывает количество апартаментов', () => {
    render(<ResidentsView user={user} />);
    // Апарт. 12 и 34
    expect(screen.getByText(/2 апартамент/i)).toBeInTheDocument();
  });

  test('показывает количество жильцов', () => {
    render(<ResidentsView user={user} />);
    // u1 + u2 + u3 = 3 (g1 — охрана, не резидент)
    expect(screen.getByText(/3 жильц/i)).toBeInTheDocument();
  });

  test('группирует жильцов по апартаментам', () => {
    render(<ResidentsView user={user} />);
    expect(screen.getByText('Апарт. 12')).toBeInTheDocument();
    expect(screen.getByText('Апарт. 34')).toBeInTheDocument();
  });

  test('охранник не попадает в список (не резидент)', () => {
    render(<ResidentsView user={user} />);
    expect(screen.queryByText('Охранник')).not.toBeInTheDocument();
  });

  test('клик на апартамент раскрывает карточку с жильцами', () => {
    render(<ResidentsView user={user} />);
    fireEvent.click(screen.getByLabelText('Апартаменты 12'));
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByText('Пётр Орлов')).toBeInTheDocument();
  });

  test('повторный клик сворачивает карточку', () => {
    render(<ResidentsView user={user} />);
    fireEvent.click(screen.getByLabelText('Апартаменты 12'));
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Апартаменты 12'));
    expect(screen.queryByText('Иван Петров')).not.toBeInTheDocument();
  });

  test('показывает номер авто в раскрытой карточке', () => {
    render(<ResidentsView user={user} />);
    fireEvent.click(screen.getByLabelText('Апартаменты 12'));
    expect(screen.getByText('А123ВС77')).toBeInTheDocument();
  });

  test('поиск по имени фильтрует апартаменты', () => {
    render(<ResidentsView user={user} />);
    fireEvent.change(screen.getByPlaceholderText(/апарт/i), { target: { value: 'Анна' } });
    // Только апарт. 34
    expect(screen.queryByText('Апарт. 12')).not.toBeInTheDocument();
    expect(screen.getByText('Апарт. 34')).toBeInTheDocument();
  });

  test('поиск по номеру авто находит нужный апартамент', () => {
    render(<ResidentsView user={user} />);
    fireEvent.change(screen.getByPlaceholderText(/апарт/i), { target: { value: 'А123' } });
    expect(screen.getByText('Апарт. 12')).toBeInTheDocument();
    expect(screen.queryByText('Апарт. 34')).not.toBeInTheDocument();
  });

  test('поиск без результатов показывает "Ничего не найдено"', () => {
    render(<ResidentsView user={user} />);
    fireEvent.change(screen.getByPlaceholderText(/апарт/i), { target: { value: 'ХХХХ' } });
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument();
  });

  test('кнопка ✕ очищает поиск', () => {
    render(<ResidentsView user={user} />);
    const input = screen.getByPlaceholderText(/апарт/i);
    fireEvent.change(input, { target: { value: 'Анна' } });
    fireEvent.click(screen.getByText('✕'));
    expect(input.value).toBe('');
  });
});
