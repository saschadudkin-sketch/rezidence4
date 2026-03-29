import { normalizePhone } from '../../utils';

// ─── Начальные данные ────────────────────────────────────────────────────────

export const PHONE_DB_INITIAL = {
  '79161234567': { uid: 'u1', name: 'Михаил Волков',  phone: '+7 916 123-45-67', role: 'owner',      apartment: '12', parkingSpot: 'A-12' },
  '79292345678': { uid: 'u2', name: 'Анна Соколова',  phone: '+7 929 234-56-78', role: 'tenant',     apartment: '34', parkingSpot: 'B-34' },
  '79033456789': { uid: 'u3', name: 'Строй Групп',    phone: '+7 903 345-67-89', role: 'contractor', apartment: '45',  parkingSpot: null },
  '79254567890': { uid: 'u4', name: 'Елена Петрова',  phone: '+7 925 456-78-90', role: 'concierge',  apartment: '—'  },
  '79175678901': { uid: 'u5', name: 'Игорь Смирнов',  phone: '+7 917 567-89-01', role: 'security',   apartment: '—'  },
  '74951230000': { uid: 'u6', name: 'Управление',     phone: '+7 495 123-00-00', role: 'admin',      apartment: '—'  },
};

export const INITIAL_USERS    = Object.fromEntries(Object.values(PHONE_DB_INITIAL).map(u => [u.uid, u]));
export const INITIAL_PHONE_DB = { ...PHONE_DB_INITIAL };
export const INITIAL_AVATARS  = {};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function usersReducer(state, action) {
  switch (action.type) {

    case 'USER_ADD': {
      const { user } = action;
      const norm = normalizePhone(user.phone);
      return {
        ...state,
        users:   { ...state.users,   [user.uid]: user },
        phoneDb: { ...state.phoneDb, [norm]:     user },
      };
    }

    case 'USER_UPDATE': {
      const { uid, patch, oldPhone } = action;
      const updated = { ...state.users[uid], ...patch };
      const newNorm = normalizePhone(patch.phone || updated.phone);
      const oldNorm = oldPhone ? normalizePhone(oldPhone) : null;

      const newPhoneDb = { ...state.phoneDb };
      if (oldNorm && oldNorm !== newNorm) delete newPhoneDb[oldNorm];
      newPhoneDb[newNorm] = updated;

      return {
        ...state,
        users:   { ...state.users, [uid]: updated },
        phoneDb: newPhoneDb,
      };
    }

    case 'USER_DELETE': {
      const { uid } = action;
      const user = state.users[uid];
      const norm = user ? normalizePhone(user.phone) : null;

      const newUsers   = { ...state.users };
      const newPhoneDb = { ...state.phoneDb };
      delete newUsers[uid];
      if (norm) delete newPhoneDb[norm];

      return { ...state, users: newUsers, phoneDb: newPhoneDb };
    }

    case 'USERS_SET_ALL': {
      // Не стираем store при пустом ответе от Firebase
      if (!action.users || action.users.length === 0) return state;
      const incoming = Object.fromEntries(action.users.map(u => [u.uid, u]));
      const incomingPh = Object.fromEntries(action.users.map(u => [normalizePhone(u.phone), u]));
      return {
        ...state,
        users:   { ...state.users, ...incoming },
        phoneDb: { ...state.phoneDb, ...incomingPh },
      };
    }

    case 'AVATAR_SET':
      return {
        ...state,
        avatars: { ...state.avatars, [action.uid]: action.avatar },
        users: state.users[action.uid]
          ? { ...state.users, [action.uid]: { ...state.users[action.uid], avatar: action.avatar } }
          : state.users,
      };

    case 'AVATAR_DELETE': {
      const newAvatars = { ...state.avatars };
      delete newAvatars[action.uid];
      return {
        ...state,
        avatars: newAvatars,
        users: state.users[action.uid]
          ? { ...state.users, [action.uid]: { ...state.users[action.uid], avatar: null } }
          : state.users,
      };
    }

    default:
      return state;
  }
}
