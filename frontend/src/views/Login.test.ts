/**
 * views/Login.test.js
 * Покрывает: Login — шаг phone, валидацию, шаг otp, демо-режим
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from './Login';
import { toast } from '../ui/Toasts';
import { services } from '../services/providers/serviceContainer';

// Мокируем зависимости
vi.mock('../store/AppStore', () => ({
  useUsers: () => ({
    phoneDb: {
      '+79161234567': { uid: 'u1', name: 'Михаил Волков', role: 'owner', apartment: '12', phone: '+7 916 123-45-67' },
    },
  }),
}));

vi.mock('../utils/phoneUtils', () => ({
  findByPhone: vi.fn((phone, db) => {
    const normalized = phone.replace(/\D/g, '');
    return Object.values(db).find(u => u.phone.replace(/\D/g, '') === normalized) || null;
  }),
  formatPhone: vi.fn((value) => value),
}));

vi.mock('../config/runtimeMode', () => ({
  isLiveMode: vi.fn(() => true),
  isDemoMode: vi.fn(() => false),
  LIVE_MODE: 'live',
  DEMO_MODE: 'demo',
  MODE: 'live',
}));

vi.mock('../ui/Toasts', () => ({
  toast: vi.fn(),
}));

vi.mock('../services/providers/serviceContainer', () => ({
  services: {
    auth: { sendOtp: vi.fn(), verifyOtp: vi.fn() },
  },
}));

vi.mock('../constants/logo', () => ({
  LOGO: 'data:image/svg+xml,<svg/>',
}));

beforeEach(() => vi.clearAllMocks());

describe('Login — шаг phone', () => {
  test('отображает поле телефона и кнопку "Получить SMS-код"', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText('+7 000 000-00-00')).toBeInTheDocument();
    expect(screen.getByText('Получить SMS-код')).toBeInTheDocument();
  });

  test('кнопка "Демо-доступ" скрыта в live-режиме', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.queryByText('Демо-доступ')).not.toBeInTheDocument();
  });

  test('показывает ошибку при коротком номере', async () => {
    render(<Login onLogin={vi.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916' } });
    fireEvent.click(screen.getByText('Получить SMS-код'));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите корректный номер', 'error');
    });
  });

  test('live: при вводе валидного номера переходит на шаг OTP', async () => {
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    render(<Login onLogin={vi.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    expect(await screen.findByPlaceholderText('• • • • • •')).toBeInTheDocument();
  });
});

describe('Login — шаг OTP', () => {
async function goToOtpStep() {
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    render(<Login onLogin={vi.fn()} />);
    const input = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(input, { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    await screen.findByPlaceholderText('• • • • • •');
  }

  test('показывает поле для кода', async () => {
    await goToOtpStep();
    expect(screen.getByPlaceholderText('• • • • • •')).toBeInTheDocument();
  });

  test('показывает ошибку при коде < 6 символов', async () => {
    const onLogin = vi.fn();
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    render(<Login onLogin={onLogin} />);
    const phoneInput = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(phoneInput, { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    await screen.findByPlaceholderText('• • • • • •');

    const otpInput = screen.getByPlaceholderText('• • • • • •');
    fireEvent.change(otpInput, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^войти$/i }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Введите код из SMS', 'error');
    });
  });

  test('live: verifyOtp с кодом 6 символов вызывает onLogin', async () => {
    const onLogin = vi.fn();
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    services.auth.verifyOtp.mockResolvedValueOnce({ uid: 'u1', role: 'owner' });
    render(<Login onLogin={onLogin} />);
    const phoneInput = screen.getByPlaceholderText('+7 000 000-00-00');
    fireEvent.change(phoneInput, { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    await screen.findByPlaceholderText('• • • • • •');

    const otpInput = screen.getByPlaceholderText('• • • • • •');
    fireEvent.change(otpInput, { target: { value: '123456' } });
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));

    expect(onLogin.mock.calls[0][0]).toMatchObject({ uid: 'u1' });
  });

  test('кнопка "Изменить номер" возвращает на шаг phone', async () => {
    await goToOtpStep();
    fireEvent.click(screen.getByText('← Изменить номер'));
    expect(screen.getByPlaceholderText('+7 000 000-00-00')).toBeInTheDocument();
  });
});

describe('Login — retry/metrics', () => {
async function openOtp() {
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('+7 000 000-00-00'), { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    await screen.findByPlaceholderText('• • • • • •');
  }

  test('на шаге OTP показывается таймер resend', async () => {
    await openOtp();
    expect(screen.getByRole('button', { name: /отправить повторно через/i })).toBeInTheDocument();
  });

  test('отправляет metric verify_rejected при коротком OTP', async () => {
    const metricSpy = vi.fn();
    window.addEventListener('rz:login-metric', metricSpy);
    await openOtp();
    fireEvent.change(screen.getByPlaceholderText('• • • • • •'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Войти'));
    await waitFor(() => expect(metricSpy).toHaveBeenCalled());
    const last = metricSpy.mock.calls.at(-1)[0].detail;
    expect(last.type).toBe('verify_rejected');
    window.removeEventListener('rz:login-metric', metricSpy);
  });

  test('отправляет metric verify_success при успешном verify', async () => {
    const onLogin = vi.fn();
    const metricSpy = vi.fn();
    window.addEventListener('rz:login-metric', metricSpy);
    services.auth.sendOtp.mockResolvedValueOnce({ ok: true });
    services.auth.verifyOtp.mockResolvedValueOnce({ uid: 'u1', role: 'owner' });
    render(<Login onLogin={onLogin} />);
    fireEvent.change(screen.getByPlaceholderText('+7 000 000-00-00'), { target: { value: '+7 916 123-45-67' } });
    fireEvent.click(screen.getByRole('button', { name: /получить sms-код/i }));
    await screen.findByPlaceholderText('• • • • • •');
    fireEvent.change(screen.getByPlaceholderText('• • • • • •'), { target: { value: '123456' } });
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    const types = metricSpy.mock.calls.map(([ev]) => ev.detail.type);
    expect(types).toContain('verify_success');
    window.removeEventListener('rz:login-metric', metricSpy);
  });
});

describe('Login — демо-список', () => {
  test('в live-режиме демо-список отсутствует', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.queryByText('+7 916 123-45-67')).not.toBeInTheDocument();
  });
});
