/**
 * views/Login.test.js
 * Покрывает: Login — шаг phone, валидацию, шаг otp, демо-режим
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Login from './Login';

// Мокируем зависимости
jest.mock('../store/AppStore', () => ({
  useUsers: () => ({
    phoneDb: {
      '+79161234567': { uid: 'u1', name: 'Михаил Волков', role: 'owner', apartment: '12', phone: '+7 916 123-45-67' },
    },
  }),
}));

jest.mock('../utils', () => ({
  findByPhone: jest.fn((phone, db) => {
    const normalized = phone.replace(/\D/g, '');
    return Object.values(db).find(u => u.phone.replace(/\D/g, '') === normalized) || null;
  }),
}));

jest.mock('../config/runtimeMode', () => ({
  isLiveMode: jest.fn(() => false),
  isDemoMode:  jest.fn(() => true),
}));

jest.mock('../ui/Toasts', () => ({
  toast: jest.fn(),
}));

jest.mock('../services/providers/backendProvider', () => ({
  authProvider: { sendOtp: jest.fn(), verifyOtp: jest.fn() },
}));

jest.mock('../constants/logo', () => ({
  LOGO: 'data:image/svg+xml,<svg/>',
}));

const { toast } = require('../ui/Toasts');

beforeEach(() => jest.clearAllMocks());

describe('Login — шаг phone', () => {
  test('отображает поле телефона и кнопку "Получить SMS-код"', () => {
    render(<Login onLogin={jest.fn()} />);
    expect(screen.getByPlaceholderText('+7 000 000-00-00')).toBeInTheDocument();
    expect(screen.getByText('Получить SMS-код')).toBeInTheDocument();
  });

  test('кнопка "Демо-доступ" видна в demo-режиме', () => {
    render(<Login onLogin={jest.fn()} />);
    expect(screen.getByText('Демо-доступ')).toBeInTheDocument();
  });

  test('показывает ошибку при коротком номере', async () => {
    render(<Login onLogin={jest.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916' } });
    fireEvent.click(screen.getByText('Получить SMS-код'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите корректный номер', 'error');
    });
  });

  test('demo: при вводе валидного номера переходит на шаг OTP', async () => {
    render(<Login onLogin={jest.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916 123-45-67' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Получить SMS-код'));
      // Ждём фейковый delay 600мс
      await new Promise(r => setTimeout(r, 700));
    });

    expect(screen.getByPlaceholderText('• • • •')).toBeInTheDocument();
  });
});

describe('Login — шаг OTP', () => {
  async function goToOtpStep() {
    render(<Login onLogin={jest.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916 123-45-67' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Получить SMS-код'));
      await new Promise(r => setTimeout(r, 700));
    });
  }

  test('показывает поле для кода', async () => {
    await goToOtpStep();
    expect(screen.getByPlaceholderText('• • • •')).toBeInTheDocument();
  });

  test('показывает ошибку при коде < 4 символов', async () => {
    const onLogin = jest.fn();
    render(<Login onLogin={onLogin} />);
    const phoneInput = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(phoneInput, { target: { value: '+7 916 123-45-67' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Получить SMS-код'));
      await new Promise(r => setTimeout(r, 700));
    });

    const otpInput = screen.getByPlaceholderText('• • • •');
    fireEvent.change(otpInput, { target: { value: '12' } });
    fireEvent.click(screen.getByText('Войти'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите код из SMS', 'error');
    });
  });

  test('demo: любой код ≥ 4 символов вызывает onLogin', async () => {
    const onLogin = jest.fn();
    render(<Login onLogin={onLogin} />);
    const phoneInput = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(phoneInput, { target: { value: '+7 916 123-45-67' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Получить SMS-код'));
      await new Promise(r => setTimeout(r, 700));
    });

    const otpInput = screen.getByPlaceholderText('• • • •');
    fireEvent.change(otpInput, { target: { value: '1234' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Войти'));
      await new Promise(r => setTimeout(r, 500));
    });

    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin.mock.calls[0][0]).toMatchObject({ uid: 'u1' });
  });

  test('кнопка "Изменить номер" возвращает на шаг phone', async () => {
    await goToOtpStep();
    fireEvent.click(screen.getByText('← Изменить номер'));
    expect(screen.getByPlaceholderText('+7 000 000-00-00')).toBeInTheDocument();
  });
});

describe('Login — демо-список', () => {
  test('кнопка "Демо-доступ" раскрывает список при клике', () => {
    render(<Login onLogin={jest.fn()} />);
    fireEvent.click(screen.getByText('Демо-доступ'));
    // В списке должны быть номера
    expect(screen.getByText('+7 916 123-45-67')).toBeInTheDocument();
  });

  test('клик по демо-номеру переключает на OTP-шаг', async () => {
    render(<Login onLogin={jest.fn()} />);
    fireEvent.click(screen.getByText('Демо-доступ'));
    fireEvent.click(screen.getByText('+7 916 123-45-67'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('• • • •')).toBeInTheDocument();
    });
  });
});
