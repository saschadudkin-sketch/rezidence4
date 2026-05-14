// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: Date | string;
  [key: string]: unknown;
}

export interface ChatState {
  chat: ChatMessage[];
  chatLastSeen: Record<string, number>;
}

type ChatAction =
  | { type: 'CHAT_SEND'; message: ChatMessage }
  | { type: 'CHAT_SET_ALL'; messages: ChatMessage[] }
  | { type: 'CHAT_UPDATE_MESSAGE'; id: string; patch: Partial<ChatMessage> }
  | { type: 'CHAT_DELETE_MESSAGE'; id: string }
  | { type: 'CHAT_MARK_SEEN'; uid: string; at?: number };

// ─── Начальные данные ────────────────────────────────────────────────────────

// Demo messages have been moved to demoProvider.js to avoid leaking into production builds.
export const INITIAL_CHAT: ChatMessage[] = [];

export const INITIAL_CHAT_LAST_SEEN: Record<string, number> = {};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {

    case 'CHAT_SEND':
      if (state.chat.some(m => m.id === action.message.id)) {
        return {
          ...state,
          chat: state.chat.map(m =>
            m.id === action.message.id ? { ...m, ...action.message } : m
          ),
        };
      }
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
