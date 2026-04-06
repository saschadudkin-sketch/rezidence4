import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatView } from './ChatView';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue({});
const getMessagesMock = vi.fn().mockResolvedValue({ messages: [], hasMore: false });

vi.mock('../services/providers/serviceContainer', () => ({
  services: { chat: { sendMessage: (...args) => sendMessageMock(...args), updateMessage: vi.fn(), deleteMessage: vi.fn(), markSeen: vi.fn(), getMessages: (...args) => getMessagesMock(...args) } },
}));
vi.mock('../config/runtimeMode', () => ({
  isLiveMode: () => true,
  isDemoMode: () => false,
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

describe('ChatView', () => {
  beforeEach(() => {
    sendMessageMock.mockClear();
    getMessagesMock.mockReset();
    getMessagesMock.mockResolvedValue({ messages: [], hasMore: false });
  });

  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<ChatView user={user} />)).not.toThrow();
  });

  test('показывает поле ввода сообщения', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    expect(screen.getByPlaceholderText(/сообщение/i)).toBeInTheDocument();
  });

  test('кнопка отправки блокируется на пустом тексте и активируется после ввода', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    const sendBtn = screen.getByLabelText(/отправить сообщение/i);
    const input = screen.getByPlaceholderText(/напишите сообщение/i);
    expect(sendBtn).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Привет' } });
    expect(sendBtn).not.toBeDisabled();
  });

  test('отправка вызывает services.chat.sendMessage', async () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    const input = screen.getByPlaceholderText(/напишите сообщение/i);
    const sendBtn = screen.getByLabelText(/отправить сообщение/i);
    fireEvent.change(input, { target: { value: 'Тест' } });
    await act(async () => {
      fireEvent.click(sendBtn);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
  });

  test('Enter без Shift отправляет сообщение', async () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    const input = screen.getByPlaceholderText(/напишите сообщение/i);
    fireEvent.change(input, { target: { value: 'Enter send' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
  });

  test('Shift+Enter не отправляет сообщение', async () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    const input = screen.getByPlaceholderText(/напишите сообщение/i);
    fireEvent.change(input, { target: { value: 'Line 1' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13, shiftKey: true });
      await Promise.resolve();
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  test('после отправки поле ввода очищается', async () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    const input = screen.getByPlaceholderText(/напишите сообщение/i);
    const sendBtn = screen.getByLabelText(/отправить сообщение/i);
    fireEvent.change(input, { target: { value: 'clear me' } });
    await act(async () => {
      fireEvent.click(sendBtn);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(input).toHaveValue(''));
  });

  test('кнопка Emoji открывает и закрывает emoji-picker', async () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    const { container } = render(<ChatView user={user} />);
    const emojiBtn = screen.getByLabelText(/emoji/i);
    expect(container.querySelector('.emoji-picker')).toBeNull();

    await act(async () => {
      fireEvent.click(emojiBtn);
      await Promise.resolve();
    });
    expect(container.querySelector('.emoji-picker')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(emojiBtn);
      await Promise.resolve();
    });
    expect(container.querySelector('.emoji-picker')).toBeNull();
  });

  test('показывает retry-блок при ошибке первичной загрузки истории', async () => {
    getMessagesMock.mockRejectedValueOnce(new Error('network'));
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    expect(await screen.findByText('История чата временно недоступна')).toBeInTheDocument();

    getMessagesMock.mockResolvedValueOnce({ messages: [], hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: /повторить/i }));
    await waitFor(() => expect(screen.queryByText('История чата временно недоступна')).not.toBeInTheDocument());
  });
});

// SEC-04: linkify XSS protection — проверяем безопасность через анализ исходного кода.
// linkify() не экспортируется, поэтому тестируем инварианты через src.
describe('linkify XSS protection (source-level)', () => {
  const fs = require('fs');
  const path = require('path');
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(process.cwd(), 'src/chat/ChatView.tsx'), 'utf8');
  });

  test('linkify использует URL-конструктор для валидации (не только regex)', () => {
    expect(src).toMatch(/new URL\(url\)/);
  });

  test('linkify содержит whitelist протоколов — только http: и https:', () => {
    // protocol check должен блокировать javascript:, data:, vbscript: и т.д.
    expect(src).toMatch(/parsed\.protocol !== ['"]https:['"] && parsed\.protocol !== ['"]http:['"]/);
  });

  test('regex linkify НЕ захватывает javascript: URL (не начинается с https?://)', () => {
    // Регулярное выражение должно начинаться с https?:\/\/
    expect(src).toContain('\\bhttps?:\\/\\/');
    // Проверка протокола должна явно ограничивать схему.
    expect(src).toContain("parsed.protocol !== 'https:' && parsed.protocol !== 'http:'");
  });

  test('linkify устанавливает rel="noopener noreferrer" на все ссылки', () => {
    expect(src).toContain('rel="noopener noreferrer"');
  });

  test('linkify устанавливает target="_blank" на все внешние ссылки', () => {
    expect(src).toContain('target="_blank"');
  });

  test('невалидный URL отображается как текст (catch block)', () => {
    // catch блок возвращает [url, part] — текст без тега <a>
    expect(src).toContain('catch {');
    expect(src).toContain('return [url, part];');
  });
});
