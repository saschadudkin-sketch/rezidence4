/**
 * views/GarageView.test.js
 * Покрывает: GarageView — список машин, добавление, редактирование, удаление, валидация
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GarageView from './GarageView';

const mockCars = [
  { id: 'car1', plate: 'А123ВС77', brand: 'BMW', note: 'Основная', isMain: true,  addedAt: new Date() },
  { id: 'car2', plate: 'В456ГД78', brand: 'Kia', note: '',          isMain: false, addedAt: new Date() },
];

const mockActions = {
  addGarageCar:    jest.fn(),
  updateGarageCar: jest.fn(),
  deleteGarageCar: jest.fn(),
};

jest.mock('../store/AppStore', () => ({
  useGarage:  jest.fn(() => mockCars),
  useActions: () => mockActions,
}));

jest.mock('../utils', () => ({
  genId: jest.fn(() => 'car-new'),
}));

jest.mock('../ui/Toasts', () => ({
  toast: jest.fn(),
}));

const { useGarage } = require('../store/AppStore');
const { toast } = require('../ui/Toasts');

beforeEach(() => jest.clearAllMocks());

describe('GarageView', () => {
  const user = { uid: 'u1', role: 'owner' };

  test('отображает список автомобилей', () => {
    render(<GarageView user={user} />);
    expect(screen.getByText('А123ВС77')).toBeInTheDocument();
    expect(screen.getByText('В456ГД78')).toBeInTheDocument();
  });

  test('отображает марку автомобиля', () => {
    render(<GarageView user={user} />);
    expect(screen.getByText('BMW')).toBeInTheDocument();
    expect(screen.getByText('Kia')).toBeInTheDocument();
  });

  test('кнопка "+ Добавить" присутствует', () => {
    render(<GarageView user={user} />);
    expect(screen.getByText(/добавить/i)).toBeInTheDocument();
  });

  test('клик "+ Добавить" открывает форму', () => {
    render(<GarageView user={user} />);
    fireEvent.click(screen.getByText(/добавить/i));
    expect(screen.getByPlaceholderText(/номер/i)).toBeInTheDocument();
  });

  test('добавление без номера показывает ошибку', () => {
    render(<GarageView user={user} />);
    fireEvent.click(screen.getByText(/добавить/i));
    fireEvent.click(screen.getByText('Сохранить'));
    expect(toast).toHaveBeenCalledWith('Введите номер автомобиля', 'error');
  });

  test('добавление дубликата номера показывает ошибку', () => {
    render(<GarageView user={user} />);
    fireEvent.click(screen.getByText(/добавить/i));
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'А123ВС77' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(toast).toHaveBeenCalledWith('Такой номер уже добавлен', 'error');
  });

  test('номер приводится к верхнему регистру', () => {
    render(<GarageView user={user} />);
    fireEvent.click(screen.getByText(/добавить/i));
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'а999бб99' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(mockActions.addGarageCar).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ plate: 'А999ББ99' })
    );
  });

  test('успешное добавление вызывает addGarageCar с id и plate', () => {
    render(<GarageView user={user} />);
    fireEvent.click(screen.getByText(/добавить/i));
    fireEvent.change(screen.getByPlaceholderText(/номер/i), { target: { value: 'Х999УУ99' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(mockActions.addGarageCar).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ id: 'car-new', plate: 'Х999УУ99' })
    );
    expect(toast).toHaveBeenCalledWith('Автомобиль добавлен', 'success');
  });

  test('клик на кнопку редактирования заполняет форму данными авто', () => {
    render(<GarageView user={user} />);
    const editButtons = screen.getAllByText(/редакт/i);
    fireEvent.click(editButtons[0]);
    expect(screen.getByDisplayValue('А123ВС77')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BMW')).toBeInTheDocument();
  });

  test('сохранение в режиме редактирования вызывает updateGarageCar', () => {
    render(<GarageView user={user} />);
    const editButtons = screen.getAllByText(/редакт/i);
    fireEvent.click(editButtons[0]);
    const plateInput = screen.getByDisplayValue('А123ВС77');
    fireEvent.change(plateInput, { target: { value: 'А123ВС77' } }); // не меняем
    fireEvent.click(screen.getByText('Сохранить'));
    expect(mockActions.updateGarageCar).toHaveBeenCalledWith(
      'u1', 'car1', expect.objectContaining({ plate: 'А123ВС77' })
    );
    expect(toast).toHaveBeenCalledWith('Автомобиль обновлён', 'success');
  });

  test('удаление авто вызывает deleteGarageCar', () => {
    render(<GarageView user={user} />);
    const deleteButtons = screen.getAllByLabelText ? screen.getAllByLabelText(/удалить/i) : screen.getAllByText(/удалить/i);
    if (deleteButtons.length > 0) {
      fireEvent.click(deleteButtons[0]);
      expect(mockActions.deleteGarageCar).toHaveBeenCalledWith('u1', expect.any(String));
    }
  });

  test('пустой гараж показывает соответствующее сообщение', () => {
    useGarage.mockReturnValueOnce([]);
    render(<GarageView user={user} />);
    expect(screen.getByText(/нет автомобилей|не добавлено|пусто/i)).toBeInTheDocument();
  });
});
