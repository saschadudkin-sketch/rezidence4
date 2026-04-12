import { ROLES } from './permissions';

export type RoleCapability =
  | 'create'
  | 'search'
  | 'scan'
  | 'approve'
  | 'arrive'
  | 'manageResidents'
  | 'blacklist'
  | 'templates'
  | 'analytics';

type RoleResponsibility = {
  capabilities: RoleCapability[];
  onboardingHint: string;
  passesNavLabel?: string;
  queueTitle?: string;
  queueSubtitle?: string;
};

export const ROLE_RESPONSIBILITIES: Record<string, RoleResponsibility> = {
  [ROLES.OWNER]: {
    capabilities: ['create', 'templates'],
    onboardingHint: 'Создайте пропуск для гостя, курьера или мастера. Охрана увидит его сразу.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.TENANT]: {
    capabilities: ['create', 'templates'],
    onboardingHint: 'Создайте пропуск для гостя или мастера. Охрана увидит его сразу.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.CONTRACTOR]: {
    capabilities: ['create', 'templates'],
    onboardingHint: 'Здесь ваши рабочие пропуска. Создайте новый, если нужно оформить въезд бригады или автомобиля.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.CONCIERGE]: {
    capabilities: ['create', 'search', 'scan', 'manageResidents', 'blacklist'],
    onboardingHint: 'Создавайте пропуска, находите гостей и сканируйте QR-коды. Решение по допуску остаётся за охраной.',
    passesNavLabel: 'Операции',
    queueTitle: 'Следующий шаг: помочь с доступом',
    queueSubtitle: 'Создайте пропуск, найдите гостя или отсканируйте QR-код',
  },
  [ROLES.SECURITY]: {
    capabilities: ['search', 'scan', 'approve', 'arrive', 'blacklist'],
    onboardingHint: 'Проверяйте пропуска, сканируйте QR-коды и отмечайте прибытие гостей.',
    passesNavLabel: 'Контроль',
    queueTitle: 'Следующий шаг: проверить доступ',
    queueSubtitle: 'Подтвердите пропуск, отсканируйте QR-код или отметьте прибытие',
  },
  [ROLES.ADMIN]: {
    capabilities: ['approve', 'manageResidents', 'analytics', 'blacklist'],
    onboardingHint: 'Контролируйте резидентов, пропуска и служебные показатели комплекса.',
    passesNavLabel: 'Операции',
  },
};

export function getRoleResponsibilities(role: string): RoleResponsibility {
  return ROLE_RESPONSIBILITIES[role] || ROLE_RESPONSIBILITIES[ROLES.OWNER];
}

export function hasRoleCapability(role: string, capability: RoleCapability): boolean {
  return getRoleResponsibilities(role).capabilities.includes(capability);
}
