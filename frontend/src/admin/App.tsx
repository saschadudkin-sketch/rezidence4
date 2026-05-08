import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PropertiesPage } from './pages/PropertiesPage';
import { PropertyDetailPage } from './pages/PropertyDetailPage';
import { ManagementCompaniesPage } from './pages/ManagementCompaniesPage';
import { ManagementCompanyDetailPage } from './pages/ManagementCompanyDetailPage';
import { AdminsPage } from './pages/AdminsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { Shell } from './Shell';
import s from './styles.module.css';

/**
 * Admin SPA root.
 *
 * Routing contract: everything except /login requires authentication.
 * While AuthProvider resolves in-tab auth state we render a bare loading
 * placeholder. Platform tokens are not persisted across reloads, so a full
 * page reload lands on /login.
 */
export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className={s.loading}>Загрузка…</div>;
  }

  if (status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/properties" element={<PropertiesPage />} />
        <Route path="/properties/:slug" element={<PropertyDetailPage />} />
        <Route path="/management-companies" element={<ManagementCompaniesPage />} />
        <Route path="/management-companies/:slug" element={<ManagementCompanyDetailPage />} />
        <Route path="/admins" element={<AdminsPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
