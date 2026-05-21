import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import type { UserMe } from '../api';
import { V1SessionProvider } from '../store';
import { OperationsNav } from './OperationsNav';

const baseUser = (role: UserMe['role']): UserMe => ({
  uid: 'user-1',
  role,
  name: 'Test',
  phone: null,
  apartment: null,
  avatar: null,
  property_slug: 'zamoskvorechie',
  property_id: 'prop-1',
  property_type: 'residential_complex',
});

function renderNav(role: UserMe['role'], path = '/v1/staff-workspace') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <V1SessionProvider initialUser={baseUser(role)}>
        <OperationsNav />
      </V1SessionProvider>
    </MemoryRouter>,
  );
}

describe('OperationsNav', () => {
  test('security can move between guard, staff and package intake pilot screens', () => {
    renderNav('security', '/v1/guard');

    const nav = screen.getByRole('navigation', { name: /пилотная навигация операций/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'КПП' })).toHaveAttribute('href', '/v1/guard');
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/v1/staff-workspace');
    expect(screen.getByRole('link', { name: 'Посылки' })).toHaveAttribute('href', '/v1/packages');
    expect(screen.queryByRole('link', { name: 'Доступ' })).toBeNull();
  });

  test('property admin gets the full pilot operations switcher', () => {
    renderNav('admin', '/v1/admin/operations');

    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/v1/staff-workspace');
    expect(screen.getByRole('link', { name: 'КПП' })).toHaveAttribute('href', '/v1/guard');
    expect(screen.getByRole('link', { name: 'Техник' })).toHaveAttribute('href', '/v1/technician-workspace');
    expect(screen.getByRole('link', { name: 'Подрядчик' })).toHaveAttribute('href', '/v1/contractor-workspace');
    expect(screen.getByRole('link', { name: 'Обзор' })).toHaveAttribute('href', '/v1/admin/operations');
    expect(screen.getByRole('link', { name: 'Доступ' })).toHaveAttribute('href', '/v1/admin/access');
    expect(screen.getByRole('link', { name: 'Outbox' })).toHaveAttribute('href', '/v1/admin/notifications');
    expect(screen.getByRole('link', { name: 'Онбординг' })).toHaveAttribute('href', '/v1/onboarding');
  });

  test('technician keeps a visible operations entry point even when only one item is allowed', () => {
    renderNav('technician', '/v1/technician-workspace');

    const nav = screen.getByRole('navigation', { name: /пилотная навигация операций/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Техник' })).toHaveAttribute('href', '/v1/technician-workspace');
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();
  });

  test('contractor keeps a visible operations entry point without staff/admin-only navigation', () => {
    renderNav('contractor', '/v1/contractor-workspace');

    const nav = screen.getByRole('navigation', { name: /пилотная навигация операций/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Подрядчик' })).toHaveAttribute('href', '/v1/contractor-workspace');
    expect(screen.queryByRole('link', { name: 'Staff' })).toBeNull();
  });
});
