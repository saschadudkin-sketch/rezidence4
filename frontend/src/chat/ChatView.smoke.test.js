import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatView } from './ChatView';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('../services/providers/serviceContainer', () => ({
  services: { chat: { sendMessage: vi.fn().mockResolvedValue({}), updateMessage: vi.fn(), deleteMessage: vi.fn(), markSeen: vi.fn() } },
}));
vi.mock('../ui/Toasts', () => ({ toast: vi.fn() }));
vi.mock('../ui/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

describe('ChatView', () => {
  test('рендерится без ошибок', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    expect(() => render(<ChatView user={user} />)).not.toThrow();
  });

  test('показывает поле ввода сообщения', () => {
    const user = { uid:'u1', role:'owner', name:'Иван' };
    render(<ChatView user={user} />);
    expect(screen.getByPlaceholderText(/сообщение/i)).toBeInTheDocument();
  });
});
