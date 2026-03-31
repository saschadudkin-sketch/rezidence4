import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChatView } from './ChatView';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue({});

vi.mock('../services/providers/serviceContainer', () => ({
  services: { chat: { sendMessage: (...args) => sendMessageMock(...args), updateMessage: vi.fn(), deleteMessage: vi.fn(), markSeen: vi.fn(), getMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }) } },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

describe('ChatView', () => {
  beforeEach(() => {
    sendMessageMock.mockClear();
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

  test('кнопка Emoji открывает и закрывает emoji-picker', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    const { container } = render(<ChatView user={user} />);
    const emojiBtn = screen.getByLabelText(/emoji/i);
    expect(container.querySelector('.emoji-picker')).toBeNull();
    fireEvent.click(emojiBtn);
    expect(container.querySelector('.emoji-picker')).toBeInTheDocument();
    fireEvent.click(emojiBtn);
    expect(container.querySelector('.emoji-picker')).toBeNull();
  });
});
