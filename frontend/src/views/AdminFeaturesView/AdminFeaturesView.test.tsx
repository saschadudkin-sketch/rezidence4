/**
 * views/AdminFeaturesView/AdminFeaturesView.test.tsx
 * Basic test for AdminFeaturesView component
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AdminFeaturesView } from './AdminFeaturesView';
import { FeatureFlagsProvider } from '../../contexts/FeatureFlagsContext';
import { describe, expect, test, vi, beforeEach } from 'vitest';

// Mock the useAuth hook to return admin user
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 'admin', uid: 'admin1' }
  })
}));

// Mock the API client
vi.mock('../../services/providers/apiClient', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({})
  }
}));

// Mock the runtime mode
vi.mock('../../config/runtimeMode', () => ({
  isLiveMode: () => false
}));

function renderWithProvider(component: React.ReactElement) {
  return render(
    <FeatureFlagsProvider>
      {component}
    </FeatureFlagsProvider>
  );
}

describe('AdminFeaturesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders main title and subtitle', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Wait for the component to load
    await screen.findByText('Настройки функций');
    expect(screen.getByText('Включайте только те возможности, которые нужны вашему объекту')).toBeInTheDocument();
  });

  test('shows category cards after loading', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Wait for loading to complete and check for category headers
    await screen.findByText('Основные');
    expect(screen.getByText('Коммуникация')).toBeInTheDocument();
    expect(screen.getByText('Доступ')).toBeInTheDocument();
  });

  test('shows chat feature as disabled (always on)', async () => {
    renderWithProvider(<AdminFeaturesView />);

    // Wait for loading and check that chat is present
    await screen.findByText('Чат жильцов');
    expect(screen.getByText('Чат жильцов с управляющей компанией и охраной')).toBeInTheDocument();
  });
});