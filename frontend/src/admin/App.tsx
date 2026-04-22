import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PropertiesPage } from './pages/PropertiesPage';
import { PropertyDetailPage } from './pages/PropertyDetailPage';
import { AdminsPage } from './pages/AdminsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { Shell } from './Shell';
import s from './styles.module.css';

/**
 * Admin SPA root.
 *
 * Routing contract: everything except /login requires authentication.
 * While the initial /stats probe is in flight we render a bare loading
 * placeholder — on a reload with a valid token this is a single round-trip;
 * on a reload with an expired token api.ts wipes storage and we land on
 * /login within the same render cycle.
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
        <Route path="/admins" element={<AdminsPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
