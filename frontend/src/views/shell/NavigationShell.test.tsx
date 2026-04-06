import React from 'react';
import { render, screen, within } from '@testing-library/react';
import NavigationShell from './NavigationShell';

function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isMobile,
      media: '(max-width:860px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('NavigationShell mobile prioritization', () => {
  beforeEach(() => setMobileViewport(true));

  test('для security оставляет 3 приоритетные вкладки и прячет остальные в "Ещё"', () => {
    const nav = [
      ['residents', 'residents', 'Жильцы', 0],
      ['chat', 'chat', 'Чат', 0],
      ['guardpost', 'shield', 'Скан', 0],
      ['passes', 'ticket', 'Проверка', 0],
      ['visitlog', 'list', 'Журнал', 0],
      ['blacklist', 'ban', 'ЧС', 0],
    ] as Array<[string, string, string, number]>;
    const navClassMap = Object.fromEntries(
      nav.flatMap(([k]) => [[k, 'tn-btn'], [`${k}_mn`, 'mn-btn']]),
    );

    const { container } = render(
      <NavigationShell
        nav={nav}
        navClassMap={navClassMap}
        goTab={vi.fn()}
        userRole="security"
      />,
    );

    const mobileNav = container.querySelector('.mobile-nav');
    expect(mobileNav).toBeInTheDocument();
    const mobile = within(mobileNav as HTMLElement);

    expect(mobile.getByRole('button', { name: /скан/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /проверка/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /журнал/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /ещё/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^чс$/i })).not.toBeInTheDocument();
  });
});
