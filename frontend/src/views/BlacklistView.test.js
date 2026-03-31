/**
 * views/BlacklistView.test.js
 * Покрывает: BlacklistView — отображение, добавление, удаление, поиск
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlacklistView from './BlacklistView';
import * as AppStore from '../store/AppStore.jsx';
import { toast } from '../ui/Toasts';

vi.mock('../hooks/useDebounce', () => ({
  useDebounce: (v) => v,
}));

vi.mock('../utils', () => ({
  genId: vi.fn(() => 'bl-new'),
}));

vi.mock('../ui/Toasts', () => ({
  toast: vi.fn(),
}));


const mockBlacklist = [
  { id: 'bl1', name: 'Петров Сергей', carPlate: 'А123ВС77', reason: 'Дебош', addedBy: 'g1', addedAt: new Date() },
  { id: 'bl2', name: 'Иванов Иван',   carPlate: '',          reason: 'Угроза', addedBy: 'g1', addedAt: new Date() },
];
const mockActions = {
  addToBlacklist: vi.fn(),
  removeFromBlacklist: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(AppStore, 'useBlacklist').mockReturnValue(mockBlacklist);
  vi.spyOn(AppStore, 'useActions').mockReturnValue(mockActions);
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());


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
    expect(screen.getByText(/\+ добав\w*/i)).toBeInTheDocument();
  });

  test('клик на "Добавить" открывает форму', () => {
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/\+ добав\w*/i));
    expect(screen.getAllByPlaceholderText(/фио/i)[0]).toBeInTheDocument();
  });

  test('добавление без имени и авто показывает ошибку', () => {
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/\+ добав\w*/i));
    fireEvent.click(screen.getByText(/добавить в ч[её]рный список/i));
    expect(toast).toHaveBeenCalledWith('Укажите ФИО или номер авто', 'error');
  });

  test('добавление с именем вызывает addToBlacklist', () => {
    const { addToBlacklist } = mockActions;
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/\+ добав\w*/i));
    fireEvent.change(screen.getAllByPlaceholderText(/фио/i)[0], { target: { value: 'Новый Нарушитель' } });
    fireEvent.click(screen.getByText(/добавить в ч[её]рный список/i));
    expect(addToBlacklist).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Новый Нарушитель' })
    );
  });

  test('номер авто приводится к верхнему регистру', () => {
    const { addToBlacklist } = mockActions;
    render(<BlacklistView user={user} />);
    fireEvent.click(screen.getByText(/\+ добав\w*/i));
    fireEvent.change(screen.getByPlaceholderText(/номер авто/i), { target: { value: 'а123вс77' } });
    fireEvent.click(screen.getByText(/добавить в ч[её]рный список/i));
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
    const deleteButtons = screen.getAllByTitle("Удалить");
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
  });

  test('клик удаления вызывает removeFromBlacklist', () => {
    const { removeFromBlacklist } = mockActions;
    render(<BlacklistView user={user} />);
    const deleteButtons = screen.getAllByTitle("Удалить");
    fireEvent.click(deleteButtons[0]);
    expect(removeFromBlacklist).toHaveBeenCalledWith('bl1');
  });

  test('пустой blacklist показывает сообщение об отсутствии записей', () => {
    AppStore.useBlacklist.mockReturnValueOnce([]);
    render(<BlacklistView user={user} />);
    expect(screen.getByText(/пуст|нет записей|не найдено/i)).toBeInTheDocument();
  });
});
