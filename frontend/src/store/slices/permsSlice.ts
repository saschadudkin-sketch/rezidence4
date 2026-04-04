// ─── Types ───────────────────────────────────────────────────────────────────

export interface PermEntry {
  id: string;
  name: string;
  phone: string;
  carPlate?: string;
}

export interface UserPerms {
  visitors: PermEntry[];
  workers: PermEntry[];
}

export interface Template {
  id: string;
  name: string;
  type: string;
  category: string;
  visitorName: string;
  visitorPhone: string;
  carPlate: string;
  comment: string;
}

export interface PermsState {
  perms: Record<string, UserPerms>;
  templates: Record<string, Template[]>;
}

type PermsAction =
  | { type: 'PERMS_SET'; uid: string; perms: UserPerms }
  | { type: 'TEMPLATE_ADD'; uid: string; template: Template }
  | { type: 'TEMPLATE_DELETE'; uid: string; id: string }
  | { type: 'TEMPLATES_SET'; uid: string; templates: Template[] };

// ─── Начальные данные ────────────────────────────────────────────────────────

export const INITIAL_PERMS: Record<string, UserPerms> = {
  'u1': {
    visitors: [
      { id: 'pv1', name: 'Анна Волкова',  phone: '+7 916 100-00-01' },
      { id: 'pv2', name: 'Сергей Волков', phone: '+7 916 100-00-02' },
    ],
    workers: [],
  },
  'u2': {
    visitors: [{ id: 'pv3', name: 'Мама', phone: '+7 929 200-00-01' }],
    workers: [],
  },
  'u3': {
    visitors: [],
    workers: [
      { id: 'pw1', name: 'Иван Рабочий',  phone: '+7 903 300-00-01', carPlate: 'А100ВС77' },
      { id: 'pw2', name: 'Пётр Мастеров', phone: '+7 903 300-00-02', carPlate: '' },
    ],
  },
};

export const INITIAL_TEMPLATES: Record<string, Template[]> = {
  'u1': [
    { id: 't1', name: 'Гость Дима',       type: 'pass', category: 'guest',   visitorName: 'Дмитрий Орлов', visitorPhone: '+7 916 777-88-99', carPlate: '', comment: '' },
    { id: 't2', name: 'Сантехник',         type: 'tech', category: 'plumber', visitorName: '',               visitorPhone: '',                 carPlate: '', comment: 'Течёт кран' },
  ],
  'u2': [],
  'u3': [
    { id: 't3', name: 'Рабочие на объект', type: 'pass', category: 'team',   visitorName: 'Бригада',        visitorPhone: '+7 903 111-22-33', carPlate: '', comment: 'Плановые работы' },
  ],
};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function permsReducer(state: PermsState, action: PermsAction): PermsState {
  switch (action.type) {

    case 'PERMS_SET':
      return { ...state, perms: { ...state.perms, [action.uid]: action.perms } };

    case 'TEMPLATE_ADD': {
      const existing = state.templates[action.uid] || [];
      return {
        ...state,
        templates: { ...state.templates, [action.uid]: [...existing, action.template] },
      };
    }

    case 'TEMPLATE_DELETE': {
      const filtered = (state.templates[action.uid] || []).filter(t => t.id !== action.id);
      return { ...state, templates: { ...state.templates, [action.uid]: filtered } };
    }

    case 'TEMPLATES_SET':
      return { ...state, templates: { ...state.templates, [action.uid]: action.templates } };

    default:
      return state;
  }
}
