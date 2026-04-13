import React from 'react';
import { render, within } from '@testing-library/react';
import { describe, beforeEach, expect, test, vi } from 'vitest';
import NavigationShell from './NavigationShell';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        (query === '(max-width:1024px)' && width <= 1024) ||
        (query === '(min-width:768px) and (max-width:1024px)' && width >= 768 && width <= 1024),
      media: query,
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
  beforeEach(() => setViewportWidth(390));

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

    expect(mobile.getByRole('button', { name: /пост/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /контроль/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /журнал/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /^стоп$/i })).toBeInTheDocument();
    expect(mobile.getByRole('button', { name: /резиденты/i })).toBeInTheDocument();
    expect(mobile.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();
    expect(mobile.queryByRole('button', { name: /ещё/i })).not.toBeInTheDocument();
  });

  test('for concierge uses top tabs instead of hiding residents and stop behind more', () => {
    const nav = [
      ['residents', 'residents', 'Жильцы', 0],
      ['chat', 'chat', 'Чат', 0],
      ['passes', 'ticket', 'Пропуска', 0],
      ['visitlog', 'list', 'Журнал', 0],
      ['blacklist', 'ban', 'ЧС', 2],
    ] as Array<[string, string, string, number]>;
    const navClassMap = Object.fromEntries(
      nav.flatMap(([key]) => [[key, 'tn-btn'], [`${key}_mn`, 'mn-btn']]),
    );

    const { container } = render(
      <NavigationShell
        nav={nav}
        navClassMap={navClassMap}
        goTab={vi.fn()}
        userRole="concierge"
      />,
    );

    const topNav = container.querySelector('.top-nav');
    const mobileNav = container.querySelector('.mobile-nav');
    expect(topNav).toBeInTheDocument();
    expect(mobileNav).toBeInTheDocument();

    const top = within(topNav as HTMLElement);
    const bottom = within(mobileNav as HTMLElement);

    expect(top.getByRole('button', { name: /резиденты/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /^стоп$/i })).toBeInTheDocument();
    expect(top.queryByText('2')).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /пропуска/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /журнал/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();

    expect(bottom.getByRole('button', { name: /пропуска/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /журнал/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /чат/i })).toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /резиденты/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /^стоп$/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /ещё/i })).not.toBeInTheDocument();
  });

  test('for owner keeps templates history and access on top, passes tech and chat on bottom', () => {
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

    expect(top.getByRole('button', { name: /шаблоны/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /история/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /доступ/i })).toBeInTheDocument();
    expect(top.queryByRole('button', { name: /пропуска/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /техслужба/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();

    expect(bottom.getByRole('button', { name: /пропуска/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /техслужба/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /чат/i })).toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /шаблоны/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /история/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /доступ/i })).not.toBeInTheDocument();
  });

  test('for contractor keeps templates history and access on top, passes tech and chat on bottom', () => {
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
        userRole="contractor"
      />,
    );

    const topNav = container.querySelector('.top-nav');
    const mobileNav = container.querySelector('.mobile-nav');
    expect(topNav).toBeInTheDocument();
    expect(mobileNav).toBeInTheDocument();

    const top = within(topNav as HTMLElement);
    const bottom = within(mobileNav as HTMLElement);

    expect(top.getByRole('button', { name: /шаблоны/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /история/i })).toBeInTheDocument();
    expect(top.getByRole('button', { name: /доступ/i })).toBeInTheDocument();
    expect(top.queryByRole('button', { name: /пропуска/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /техслужба/i })).not.toBeInTheDocument();
    expect(top.queryByRole('button', { name: /чат/i })).not.toBeInTheDocument();

    expect(bottom.getByRole('button', { name: /пропуска/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /техслужба/i })).toBeInTheDocument();
    expect(bottom.getByRole('button', { name: /чат/i })).toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /шаблоны/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /история/i })).not.toBeInTheDocument();
    expect(bottom.queryByRole('button', { name: /доступ/i })).not.toBeInTheDocument();
  });
});
