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

describe('ChatView audit fixes', () => {
  const getSource = async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sourcePath = path.resolve(process.cwd(), 'src/chat/ChatView.jsx');
    return fs.readFileSync(sourcePath, 'utf8');
  };

  test('FIX BUG-3: prevMsg использует filteredChat[i-1], а не chat[i-1]', async () => {
    const src = await getSource();
    expect(src).toContain('filteredChat[i - 1]');
    expect(src).not.toMatch(/= chat\[i - 1\]/);
  });

  test('FIX BUG-4: msgTimestamps Map кешируется через useMemo', async () => {
    const src = await getSource();
    expect(src).toContain('msgTimestamps');
    expect(src).toMatch(/msgTimestamps = useMemo/);
  });

  test('FIX BUG-9: click-listener закрытия меню зарегистрирован', async () => {
    const src = await getSource();
    expect(src).toContain("document.addEventListener('mousedown', handleOutsideClick)");
    expect(src).toContain("document.addEventListener('touchstart', handleOutsideClick)");
  });

  test('FIX BUG-15: onFileChange обёрнут в useCallback', async () => {
    expect(await getSource()).toMatch(/onFileChange = useCallback/);
  });

  test('FIX BUG-20: msgRefs Map для навигации к цитатам (не document.querySelector)', async () => {
    const src = (await getSource()).replace(/\/\/[^\n]*/g, '');
    expect(src).not.toContain('document.querySelector');
    expect(src).toContain('msgRefs.current');
    expect(src).toContain('scrollToMsg');
  });
});
