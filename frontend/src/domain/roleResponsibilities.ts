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
    onboardingHint: 'Нажмите «Создать пропуск», чтобы оформить доступ для гостя, курьера или мастера. Охрана получит заявку автоматически.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.TENANT]: {
    capabilities: ['create', 'templates'],
    onboardingHint: 'Создайте пропуск для гостя или мастера. Охрана получит заявку автоматически.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.CONTRACTOR]: {
    capabilities: ['create', 'templates'],
    onboardingHint: 'Здесь ваши рабочие пропуска. Создайте новый, если нужно оформить въезд бригады или автомобиля.',
    passesNavLabel: 'Пропуска',
  },
  [ROLES.CONCIERGE]: {
    capabilities: ['create', 'search', 'scan', 'manageResidents', 'blacklist'],
    onboardingHint: 'Консьерж проводит доступ: создаёт заявки, находит пропуска и сканирует QR-коды. Подтверждение и отметка прибытия остаются за охраной.',
    passesNavLabel: 'Операции',
    queueTitle: 'Следующий шаг: провести доступ',
    queueSubtitle: 'Создайте заявку, найдите пропуск или отсканируйте QR-код для посетителя',
  },
  [ROLES.SECURITY]: {
    capabilities: ['search', 'scan', 'approve', 'arrive', 'blacklist'],
    onboardingHint: 'Охрана подтверждает заявки, сканирует QR-коды и отмечает прибытие посетителей.',
    passesNavLabel: 'Контроль',
    queueTitle: 'Следующий шаг: подтвердить доступ',
    queueSubtitle: 'Подтвердите заявку, отсканируйте QR-код или отметьте прибытие посетителя',
  },
  [ROLES.ADMIN]: {
    capabilities: ['approve', 'manageResidents', 'analytics', 'blacklist'],
    onboardingHint: 'Управляйте пользователями, заявками и ключевыми метриками из административной панели.',
    passesNavLabel: 'Операции',
  },
};

export function getRoleResponsibilities(role: string): RoleResponsibility {
  return ROLE_RESPONSIBILITIES[role] || ROLE_RESPONSIBILITIES[ROLES.OWNER];
}

export function hasRoleCapability(role: string, capability: RoleCapability): boolean {
  return getRoleResponsibilities(role).capabilities.includes(capability);
}
