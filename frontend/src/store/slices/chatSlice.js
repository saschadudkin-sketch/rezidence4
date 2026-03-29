// ─── Начальные данные ────────────────────────────────────────────────────────

// Demo messages have been moved to demoProvider.js to avoid leaking into production builds.
export const INITIAL_CHAT = [];

export const INITIAL_CHAT_LAST_SEEN = {};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function chatReducer(state, action) {
  switch (action.type) {

    case 'CHAT_SEND':
      return { ...state, chat: [...state.chat, action.message] };

    case 'CHAT_SET_ALL':
      return { ...state, chat: action.messages };

    case 'CHAT_UPDATE_MESSAGE':
      return {
        ...state,
        chat: state.chat.map(m =>
          m.id === action.id ? { ...m, ...action.patch } : m
        ),
      };

    case 'CHAT_DELETE_MESSAGE':
      return {
        ...state,
        chat: state.chat.filter(m => m.id !== action.id),
      };

    case 'CHAT_MARK_SEEN':
      // FIX [ARCH]: reducer должен быть чистой функцией — Date.now() создаёт side effect.
      // Временная метка теперь передаётся в action.at (или fallback для обратной совместимости).
      return {
        ...state,
        chatLastSeen: { ...state.chatLastSeen, [action.uid]: action.at ?? Date.now() },
      };

    default:
      return state;
  }
}
