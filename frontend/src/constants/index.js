// ─── Роли ────────────────────────────────────────────────────────────────────

export const ROLE_LABELS = {
  owner:      'Собственник',
  tenant:     'Арендатор',
  contractor: 'Подрядчик',
  concierge:  'Консьерж',
  security:   'Охрана',
  admin:      'Администратор',
};

export const ROLE_ICONS = {
  owner:      'users',
  tenant:     'door',
  contractor: 'tools',
  concierge:  'chat',
  security:   'shield',
  admin:      'chart',
};

export const ROLE_COLOR = {
  owner:      'var(--role-owner)',
  tenant:     'var(--role-tenant)',
  contractor: 'var(--role-contractor)',
  concierge:  'var(--role-concierge)',
  security:   'var(--role-security)',
  admin:      'var(--role-admin)',
};

// ─── Категории заявок ────────────────────────────────────────────────────────

export const CAT_ICON = {
  guest:       'users',
  courier:     'file',
  taxi:        'car',
  car:         'car',
  master:      'tools',
  worker:      'tools',
  team:        'users',
  delivery:    'car',
  electrician: 'alert',
  plumber:     'tools',
};

export const CAT_LABEL = {
  guest:       'Гость',
  courier:     'Курьер',
  taxi:        'Такси',
  car:         'Автомобиль',
  master:      'Мастер',
  worker:      'Рабочий',
  team:        'Бригада',
  delivery:    'Доставка',
  electrician: 'Электрик',
  plumber:     'Сантехник',
};

// ─── Статусы заявок ──────────────────────────────────────────────────────────

export const STS_LABEL = {
  pending:   'В обработке',
  approved:  'Допуск открыт',
  rejected:  'Отказано',
  accepted:  'Принято',
  arrived:   'На территории',
  scheduled: 'Запланировано',
  expired:   'Истёк',
  cancelled: 'Отменено',
};

// ─── Тип пропуска (длительность) ────────────────────────────────────────────

export const PASS_DURATION = {
  once:      'once',       // разовый — закрывается после входа
  temporary: 'temporary',  // временный — действует до validUntil
  permanent: 'permanent',  // постоянный — бессрочный, многоразовый
};

export const PASS_DURATION_LABEL = {
  once:      'Разовый',
  temporary: 'Временный',
  permanent: 'Постоянный',
};

export const PASS_DURATION_ICON = {
  once:      'ticket',
  temporary: 'history',
  permanent: 'shield',
};

export const PASS_DURATION_DESC = {
  once:      'Одно посещение',
  temporary: 'Действует до указанной даты',
  permanent: 'Бессрочный, многоразовый',
};

// ─── Общие inline-стили (shared style shortcuts) ────────────────────────────

export const S_CARD = {
  background:   'var(--s2)',
  border:       '1px solid var(--b1)',
  borderRadius: 'var(--r)',
};

export const S_ROW = {
  display:    'flex',
  alignItems: 'center',
  gap:        8,
};

export const S_END = {
  display:        'flex',
  gap:            8,
  justifyContent: 'flex-end',
};

// ─── Контакты / коммерческая упаковка ───────────────────────────────────────

export const CONTACT_EMAIL = 'sales@rezidence-access.ru';

// ─── Группы категорий (для условий в форме заявки) ──────────────────────────

/** Категории, требующие номер автомобиля */
export const CATS_WITH_CAR_PLATE  = ['taxi', 'car', 'master', 'delivery'];

/** Категории, где имя посетителя необязательно */
export const CATS_NAME_OPTIONAL   = ['car', 'master', 'courier'];

/** Категории без поля «имя посетителя» (одного) */
export const CATS_WITHOUT_VISITOR = ['taxi', 'team'];

/** Категории без поля «телефон» */
export const CATS_WITHOUT_PHONE   = ['taxi', 'team'];

/** Категории без кнопки «выбрать из постоянного списка» */
export const CATS_WITHOUT_PERMS   = ['taxi', 'team', 'courier'];

/** Технические категории */
export const CATS_TECH = ['electrician', 'plumber'];

/** Пропускные категории для обычного жильца */
export const CATS_PASS_RESIDENT   = ['guest', 'courier', 'taxi', 'car', 'master'];

/** Пропускные категории для подрядчика */
export const CATS_PASS_CONTRACTOR = ['worker', 'team', 'delivery', 'car'];
