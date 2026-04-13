// Roles

export const ROLE_LABELS = {
  owner: 'Собственник',
  tenant: 'Арендатор',
  contractor: 'Подрядчик',
  concierge: 'Консьерж',
  security: 'Охрана',
  admin: 'Администратор',
} as const;

export const ROLE_ICONS = {
  owner: 'users',
  tenant: 'door',
  contractor: 'tools',
  concierge: 'chat',
  security: 'shield',
  admin: 'chart',
} as const;

export const ROLE_COLOR = {
  owner: 'var(--role-owner)',
  tenant: 'var(--role-tenant)',
  contractor: 'var(--role-contractor)',
  concierge: 'var(--role-concierge)',
  security: 'var(--role-security)',
  admin: 'var(--role-admin)',
} as const;

// Request categories

export const CAT_ICON = {
  guest: 'users',
  courier: 'courier',
  taxi: 'taxi',
  car: 'car',
  master: 'tools',
  worker: 'tools',
  team: 'users',
  delivery: 'car',
  electrician: 'tools',
  plumber: 'tools',
} as const;

export const CAT_LABEL = {
  guest: 'Гость',
  courier: 'Курьер',
  taxi: 'Такси',
  car: 'Автомобиль',
  master: 'Мастер',
  worker: 'Рабочий',
  team: 'Бригада',
  delivery: 'Доставка',
  electrician: 'Электрик',
  plumber: 'Сантехник',
} as const;

// Request statuses

export const STS_LABEL = {
  pending: 'В обработке',
  approved: 'Допуск открыт',
  rejected: 'Отказано',
  accepted: 'Принято',
  arrived: 'На территории',
  scheduled: 'Запланировано',
  expired: 'Истёк',
  cancelled: 'Отменено',
} as const;

// Pass duration

export const PASS_DURATION = {
  once: 'once',
  temporary: 'temporary',
  permanent: 'permanent',
} as const;

export const PASS_DURATION_LABEL = {
  once: 'Разовый',
  temporary: 'Временный',
  permanent: 'Постоянный',
} as const;

export const PASS_DURATION_ICON = {
  once: 'ticket',
  temporary: 'clock',
  permanent: 'shield',
} as const;

export const PASS_DURATION_DESC = {
  once: 'Одно посещение',
  temporary: 'Действует до указанной даты',
  permanent: 'Бессрочный, многоразовый',
} as const;

// Shared style shortcuts

export const S_CARD = {
  background: 'var(--s2)',
  border: '1px solid var(--b1)',
  borderRadius: 'var(--r)',
};

export const S_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const S_END = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

// Contacts

export const CONTACT_EMAIL = 'sales@rezidence-access.ru';

// Category groups for request forms

export const CATS_WITH_CAR_PLATE = ['taxi', 'car', 'master', 'delivery'];
export const CATS_NAME_OPTIONAL = ['car', 'master', 'courier'];
export const CATS_WITHOUT_VISITOR = ['taxi', 'team'];
export const CATS_WITHOUT_PHONE = ['taxi', 'team'];
export const CATS_WITHOUT_PERMS = ['taxi', 'team', 'courier'];
export const CATS_TECH = ['electrician', 'plumber'];
export const CATS_PASS_RESIDENT = ['guest', 'courier', 'taxi', 'car', 'master'];
export const CATS_PASS_CONTRACTOR = ['worker', 'team', 'delivery', 'car'];
