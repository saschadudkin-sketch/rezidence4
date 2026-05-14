/**
 * store/slices/chatSlice.test.js
 * Покрывает: chatReducer — все экшены, ARCH-fix (чистая функция без Date.now)
 */

import { chatReducer, INITIAL_CHAT, INITIAL_CHAT_LAST_SEEN } from './chatSlice';

const baseState = {
  chat: [
    { id: 'm1', uid: 'u1', text: 'Привет', at: '2026-03-15T10:00:00' },
    { id: 'm2', uid: 'u2', text: 'Здравствуйте', at: '2026-03-15T10:01:00' },
  ],
  chatLastSeen: { u1: 1000 },
};

describe('INITIAL values', () => {
  test('INITIAL_CHAT — пустой массив', () => {
    expect(INITIAL_CHAT).toEqual([]);
  });

  test('INITIAL_CHAT_LAST_SEEN — пустой объект', () => {
    expect(INITIAL_CHAT_LAST_SEEN).toEqual({});
  });
});

describe('chatReducer — CHAT_SEND', () => {
  test('добавляет сообщение в конец массива', () => {
    const msg = { id: 'm3', uid: 'u1', text: 'Новое', at: '2026-03-15T10:02:00' };
    const result = chatReducer(baseState, { type: 'CHAT_SEND', message: msg });
    expect(result.chat).toHaveLength(3);
    expect(result.chat[2]).toBe(msg);
  });

  test('не мутирует исходный массив', () => {
    const msg = { id: 'm3', uid: 'u1', text: 'Новое' };
    const original = [...baseState.chat];
    chatReducer(baseState, { type: 'CHAT_SEND', message: msg });
    expect(baseState.chat).toEqual(original);
  });

  test('остальные поля состояния не изменяются', () => {
    const msg = { id: 'm3', uid: 'u1', text: 'Новое' };
    const result = chatReducer(baseState, { type: 'CHAT_SEND', message: msg });
    expect(result.chatLastSeen).toBe(baseState.chatLastSeen);
  });

  test('дедуплицирует replay/SSE сообщение по id', () => {
    const result = chatReducer(baseState, {
      type: 'CHAT_SEND',
      message: { id: 'm2', uid: 'u2', text: 'Обновлено', at: '2026-03-15T10:01:30' },
    });
    expect(result.chat).toHaveLength(2);
    expect(result.chat[1].text).toBe('Обновлено');
  });
});

describe('chatReducer — CHAT_SET_ALL', () => {
  test('заменяет весь массив сообщений', () => {
    const messages = [{ id: 'x1', uid: 'u3', text: 'Загружено' }];
    const result = chatReducer(baseState, { type: 'CHAT_SET_ALL', messages });
    expect(result.chat).toBe(messages);
  });

  test('пустой массив очищает чат', () => {
    const result = chatReducer(baseState, { type: 'CHAT_SET_ALL', messages: [] });
    expect(result.chat).toEqual([]);
  });

  test('chatLastSeen не трогается', () => {
    const result = chatReducer(baseState, { type: 'CHAT_SET_ALL', messages: [] });
    expect(result.chatLastSeen).toBe(baseState.chatLastSeen);
  });
});

describe('chatReducer — CHAT_UPDATE_MESSAGE', () => {
  test('обновляет только нужное сообщение', () => {
    const result = chatReducer(baseState, {
      type: 'CHAT_UPDATE_MESSAGE',
      id: 'm1',
      patch: { text: 'Исправлено', edited: true },
    });
    expect(result.chat[0].text).toBe('Исправлено');
    expect(result.chat[0].edited).toBe(true);
    // Второе сообщение не тронуто
    expect(result.chat[1].text).toBe('Здравствуйте');
  });

  test('оригинальный объект не мутируется', () => {
    const original = baseState.chat[0].text;
    chatReducer(baseState, { type: 'CHAT_UPDATE_MESSAGE', id: 'm1', patch: { text: 'X' } });
    expect(baseState.chat[0].text).toBe(original);
  });

  test('если id не найден — массив не изменяется', () => {
    const result = chatReducer(baseState, {
      type: 'CHAT_UPDATE_MESSAGE',
      id: 'nonexistent',
      patch: { text: 'X' },
    });
    expect(result.chat).toEqual(baseState.chat);
  });

  test('patch мержится поверх существующих полей', () => {
    const result = chatReducer(baseState, {
      type: 'CHAT_UPDATE_MESSAGE',
      id: 'm1',
      patch: { reactions: { '👍': ['u2'] } },
    });
    // Текст сохранился
    expect(result.chat[0].text).toBe('Привет');
    // Реакции добавлены
    expect(result.chat[0].reactions).toEqual({ '👍': ['u2'] });
  });
});

describe('chatReducer — CHAT_DELETE_MESSAGE', () => {
  test('удаляет сообщение по id', () => {
    const result = chatReducer(baseState, { type: 'CHAT_DELETE_MESSAGE', id: 'm1' });
    expect(result.chat).toHaveLength(1);
    expect(result.chat[0].id).toBe('m2');
  });

  test('если id не найден — массив не изменяется по длине', () => {
    const result = chatReducer(baseState, { type: 'CHAT_DELETE_MESSAGE', id: 'ghost' });
    expect(result.chat).toHaveLength(2);
  });

  test('удаление последнего сообщения даёт пустой массив', () => {
    const singleState = { ...baseState, chat: [baseState.chat[0]] };
    const result = chatReducer(singleState, { type: 'CHAT_DELETE_MESSAGE', id: 'm1' });
    expect(result.chat).toEqual([]);
  });
});

describe('chatReducer — CHAT_MARK_SEEN', () => {
  test('устанавливает временную метку для uid', () => {
    const at = 9999999;
    const result = chatReducer(baseState, { type: 'CHAT_MARK_SEEN', uid: 'u2', at });
    expect(result.chatLastSeen.u2).toBe(at);
    // Существующая метка u1 не изменилась
    expect(result.chatLastSeen.u1).toBe(1000);
  });

  test('ARCH: метка берётся из action.at — reducer остаётся чистой функцией', () => {
    // Вызываем дважды с одинаковым action.at — результат должен быть одинаковым
    const at = 1234567890;
    const r1 = chatReducer(baseState, { type: 'CHAT_MARK_SEEN', uid: 'u3', at });
    const r2 = chatReducer(baseState, { type: 'CHAT_MARK_SEEN', uid: 'u3', at });
    expect(r1.chatLastSeen.u3).toBe(r2.chatLastSeen.u3);
    expect(r1.chatLastSeen.u3).toBe(at);
  });

  test('обновляет существующую метку', () => {
    const result = chatReducer(baseState, { type: 'CHAT_MARK_SEEN', uid: 'u1', at: 9000 });
    expect(result.chatLastSeen.u1).toBe(9000);
  });

  test('chat не изменяется', () => {
    const result = chatReducer(baseState, { type: 'CHAT_MARK_SEEN', uid: 'u1', at: 9000 });
    expect(result.chat).toBe(baseState.chat);
  });
});

describe('chatReducer — default', () => {
  test('неизвестный экшен возвращает то же самое состояние', () => {
    const result = chatReducer(baseState, { type: 'UNKNOWN_ACTION' });
    expect(result).toBe(baseState);
  });
});
