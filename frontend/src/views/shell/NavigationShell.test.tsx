import React from 'react';
import { render, within } from '@testing-library/react';
import { describe, beforeEach, expect, test, vi } from 'vitest';
import NavigationShell from './NavigationShell';

function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: isMobile,
      media: '(max-width:1024px)',
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

  test('shows all security tabs in the mobile bottom navigation', () => {
    const nav = [
      ['residents', 'residents', 'Жильцы', 0],
      ['chat', 'chat', 'Чат', 0],
      ['guardpost', 'shield', 'Скан', 0],
      ['passes', 'ticket', 'Проверка', 0],
      ['visitlog', 'list', 'Журнал', 0],
      ['blacklist', 'ban', 'ЧС', 0],
    ] as Array<[string, string, string, number]>;
    const navClassMap = Object.fromEntries(
      nav.flatMap(([key]) => [[key, 'tn-btn'], [`${key}_mn`, 'mn-btn']]),
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
    expect(mobile.getByRole('button', { name: /контроль/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /журнал/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /^чс$/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /жильцы/i })).toBeInTheDocument();
    expect(mobile.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();
    expect(mobile.queryByRole('button', { name: /ещё/i })).not.toBeInTheDocument();
  });

  test('for owner keeps only passes tech and perms in the top mobile strip', () => {
    const nav = [
      ['passes', 'ticket', 'Пропуска', 0],
      ['tech', 'tools', 'Техслужба', 0],
      ['perms', 'list', 'Доступ', 0],
      ['templates', 'file', 'Шаблоны', 0],
      ['history', 'history', 'История', 0],
      ['chat', 'chat', 'Чат', 0],
    ] as Array<[string, string, string, number]>;
    const navClassMap = Object.fromEntries(
      nav.flatMap(([key]) => [[key, 'tn-btn'], [`${key}_mn`, 'mn-btn']]),
    );

    const { container } = render(
      <NavigationShell
        nav={nav}
        navClassMap={navClassMap}
        goTab={vi.fn()}
        userRole="owner"
      />,
    );

    const topNav = container.querySelector('.top-nav');
    const mobileNav = container.querySelector('.mobile-nav');
    expect(topNav).toBeInTheDocument();
    expect(mobileNav).toBeInTheDocument();

    const top = within(topNav as HTMLElement);
    const bottom = within(mobileNav as HTMLElement);

    expect(top.getByRole('button', { name: /пропуска/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /техслужба/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /доступ/i })).toBeInTheDocument();
    expect(top.queryByRole('button', { name: /шаблоны/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /история/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();

    expect(bottom.getByRole('button', { name: /шаблоны/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /история/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /чат/i })).toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /пропуска/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /техслужба/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /доступ/i })).not.toBeInTheDocument();
  });
});
