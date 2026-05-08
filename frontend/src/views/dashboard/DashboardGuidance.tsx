import { useState } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { getRoleResponsibilities } from '../../domain/roleResponsibilities';
import { clearAppStorage, isDemoPrivateSessionEnabled, writeStorage, STORAGE_KEYS } from '../../store/persistence/storageRegistry';
import { toast } from '../../ui/Toasts';
import type { UserRole } from '../../store/slices/usersSlice';

type DemoBannerProps = {
  onClose: () => void;
};

type OnboardingHintProps = {
  role: UserRole;
  onClose: () => void;
};

const COMPACT_ONBOARDING_HINTS: Partial<Record<UserRole, string>> = {
  contractor: 'Здесь оформляются рабочие пропуска для бригады и автомобиля.',
  concierge: 'Создавайте пропуска и быстро находите резидентов и гостей.',
  security: 'Проверяйте пропуска, сканируйте QR и отмечайте прибытие.',
  admin: 'Контролируйте резидентов, пропуска и показатели комплекса.',
};

export function DemoBanner({ onClose }: DemoBannerProps) {
  const [privateSession, setPrivateSession] = useState(() => isDemoPrivateSessionEnabled());

  const togglePrivateSession = () => {
    const next = !privateSession;
    setPrivateSession(next);
    writeStorage(STORAGE_KEYS.DEMO_PRIVATE_SESSION, next ? '1' : '0');
  };

  const wipeDemoData = () => {
    clearAppStorage();
    toast('Локальные демо-данные очищены', 'success');
  };

  return (
    <div className="demo-welcome-banner" role="status" aria-live="polite">
      <span className="demo-welcome-icon"><AppIcon name="info" size={14} /></span>
      <span className="demo-welcome-text">
        <span className="demo-welcome-copy demo-welcome-copy-compact">
          <strong>Демо.</strong> Пропуска и служебные действия работают локально.
        </span>
        <span className="demo-welcome-copy demo-welcome-copy-short">
          <strong>Демо.</strong> Все сценарии работают локально, без сервера.
        </span>
        <span className="demo-welcome-copy demo-welcome-copy-long">
          <strong>Демо-режим.</strong>{' '}
          Проверяйте ключевые сценарии локально: пропуска, поиск и служебные действия работают без сервера.
          По умолчанию сессия приватная; постоянное хранение включается только вручную.
        </span>
      </span>
      <div className="demo-welcome-actions">
        <fieldset className="demo-private-toggle">
          <legend>Настройки демо-сессии</legend>
          <label>
            <input type="checkbox" checked={privateSession} onChange={togglePrivateSession} />
            <span className="demo-private-toggle-long">Приватная демо-сессия</span>
            <span className="demo-private-toggle-short">Приватно</span>
          </label>
        </fieldset>
        <button className="btn-outline demo-welcome-reset" onClick={wipeDemoData}>
          <span className="demo-welcome-reset-long">Очистить демо-данные</span>
          <span className="demo-welcome-reset-short">Очистить</span>
        </button>
      </div>
      <button className="demo-welcome-close" onClick={onClose} aria-label="Закрыть баннер">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

export function OnboardingHint({ role, onClose }: OnboardingHintProps) {
  const hint = getRoleResponsibilities(role).onboardingHint;
  const compactHint = COMPACT_ONBOARDING_HINTS[role] || hint;
  if (!hint) return null;

  return (
    <div className="onboarding-hint" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="info" size={14} /></span>
      <span className="onboarding-hint-text">
        <span className="onboarding-hint-copy onboarding-hint-copy-full">{hint}</span>
        <span className="onboarding-hint-copy onboarding-hint-copy-compact">{compactHint}</span>
      </span>
      <button className="onboarding-hint-close" onClick={onClose} aria-label="Закрыть подсказку">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}
