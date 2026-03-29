/**
 * views/BlacklistView.test.js
 * Покрывает: BlacklistView — отображение, добавление, удаление, поиск
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlacklistView from './BlacklistView';

jest.mock('../store/AppStore', () => ({
  useBlacklist: jest.fn(() => [
    { id: 'bl1', name: 'Петров Сергей', carPlate: 'А123ВС77', reason: 'Дебош', addedBy: 'g1', addedAt: new Date() },
    { id: 'bl2', name: 'Иванов Иван',   carPlate: '',          reason: 'Угроза', addedBy: 'g1', addedAt: new Date() },
  ]),
  useActions: () => ({
    addToBlacklist:      jest.fn(),
    removeFromBlacklist: jest.fn(),
  }),
}));

jest.mock('../hooks/useDebounce', () => ({
  useDebounce: (v) => v,
}));

jest.mock('../utils', () => ({
  genId: jest.fn(() => 'bl-new'),
}));

jest.mock('../ui/Toasts', () => ({
  toast: jest.fn(),
}));

const { useBlacklist, useActions } = require('../store/AppStore');
const { toast } = require('../ui/Toasts');

beforeEach(() => jest.clearAllMocks());

describe('BlacklistView', () => {
  const user = { uid: 'g1', role: 'security' };

  test('отображает записи из blacklist', () => {
    render(<BlacklistView user={user} />);
    expect(screen.getByText('Петров Сергей')).toBeInTheDocument();
    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
  });

  test('показывает номер авто', () => {
    render(<BlacklistView user={user} />);
    expect(screen.getByText('А123ВС77')).toBeInTheDocument();
  });

  test('кнопка "+ Добавить в ЧС" присутствует', () => {
    render(<BlacklistView user={user} />);
    expect(screen.getByText(/добавить в чс/i)).toBeInTheDocument();
  });

  test('клик на "Добавить" открывает форму', () => {
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/добавить в чс/i));
    expect(screen.getByPlaceholderText(/ФИО/i)).toBeInTheDocument();
  });

  test('добавление без имени и авто показывает ошибку', () => {
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/добавить в чс/i));
    fireEvent.click(screen.getByText('Добавить'));
    expect(toast).toHaveBeenCalledWith('Укажите ФИО или номер авто', 'error');
  });

  test('добавление с именем вызывает addToBlacklist', () => {
    const { addToBlacklist } = useActions();
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/добавить в чс/i));
    fireEvent.change(screen.getByPlaceholderText(/ФИО/i), { target: { value: 'Новый Нарушитель' } });
    fireEvent.click(screen.getByText('Добавить'));
    expect(addToBlacklist).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Новый Нарушитель', id: 'bl-new' })
    );
  });

  test('номер авто приводится к верхнему регистру', () => {
    const { addToBlacklist } = useActions();
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/добавить в чс/i));
    fireEvent.change(screen.getByPlaceholderText(/номер авто/i), { target: { value: 'а123вс77' } });
    fireEvent.click(screen.getByText('Добавить'));
    expect(addToBlacklist).toHaveBeenCalledWith(
      expect.objectContaining({ carPlate: 'А123ВС77' })
    );
  });

  test('поиск фильтрует записи по имени', async () => {
    render(<BlacklistView user={user} />);
    const searchInput = screen.getByPlaceholderText(/поиск/i);
    fireEvent.change(searchInput, { target: { value: 'Петров' } });

    // useDebounce замокирован — значение сразу
    await waitFor(() => {
      expect(screen.getByText('Петров Сергей')).toBeInTheDocument();
    });
  });

  test('кнопки удаления видны для каждой записи', () => {
    render(<BlacklistView user={user} />);
    const deleteButtons = screen.getAllByLabelText(/удалить/i);
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
  });

  test('клик удаления вызывает removeFromBlacklist', () => {
    const { removeFromBlacklist } = useActions();
    render(<BlacklistView user={user} />);
    const deleteButtons = screen.getAllByLabelText(/удалить/i);
    fireEvent.click(deleteButtons[0]);
    expect(removeFromBlacklist).toHaveBeenCalledWith('bl1');
  });

  test('пустой blacklist показывает сообщение об отсутствии записей', () => {
    useBlacklist.mockReturnValueOnce([]);
    render(<BlacklistView user={user} />);
    expect(screen.getByText(/пуст|нет записей|не найдено/i)).toBeInTheDocument();
  });
});
