/**
 * store/slices/permsSlice.test.js
 * Покрывает: permsReducer — PERMS_SET, TEMPLATE_ADD, TEMPLATE_DELETE, TEMPLATES_SET
 */

import { permsReducer, INITIAL_PERMS, INITIAL_TEMPLATES } from './permsSlice';

const baseState: any = {
  perms: {
    u1: {
      visitors: [{ id: 'pv1', name: 'Гость', phone: '+79001234567' }],
      workers:  [],
    },
  },
  templates: {
    u1: [
      { id: 't1', name: 'Шаблон 1', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' },
      { id: 't2', name: 'Шаблон 2', type: 'tech', category: 'service', visitorName: '', visitorPhone: '', carPlate: '', comment: '' },
    ],
    u2: [],
  },
};

describe('INITIAL values', () => {
  test('INITIAL_PERMS содержит демо-данные', () => {
    expect(INITIAL_PERMS).toBeDefined();
    expect(typeof INITIAL_PERMS).toBe('object');
    // u1 должен иметь visitors и workers
    expect(INITIAL_PERMS.u1.visitors).toBeDefined();
    expect(INITIAL_PERMS.u1.workers).toBeDefined();
  });

  test('INITIAL_TEMPLATES содержит демо-шаблоны', () => {
    expect(INITIAL_TEMPLATES).toBeDefined();
    expect(typeof INITIAL_TEMPLATES).toBe('object');
  });
});

describe('permsReducer — PERMS_SET', () => {
  test('устанавливает perms для uid', () => {
    const newPerms = { visitors: [{ id: 'pv2', name: 'Новый гость', phone: '' }], workers: [] };
    const result = permsReducer(baseState, { type: 'PERMS_SET', uid: 'u1', perms: newPerms });
    expect(result.perms.u1).toEqual(newPerms);
  });

  test('не затирает perms других пользователей', () => {
    const result = permsReducer(baseState, {
      type: 'PERMS_SET',
      uid: 'u2',
      perms: { visitors: [], workers: [] },
    });
    expect(result.perms.u1).toBe(baseState.perms.u1);
    expect(result.perms.u2).toEqual({ visitors: [], workers: [] });
  });

  test('добавляет запись для нового uid', () => {
    const perms = { visitors: [], workers: [{ id: 'w1', name: 'Слесарь', phone: '' }] };
    const result = permsReducer(baseState, { type: 'PERMS_SET', uid: 'u99', perms });
    expect(result.perms.u99).toEqual(perms);
    expect(result.perms.u1).toBe(baseState.perms.u1);
  });

  test('templates не изменяются', () => {
    const result = permsReducer(baseState, {
      type: 'PERMS_SET',
      uid: 'u1',
      perms: { visitors: [], workers: [] },
    });
    expect(result.templates).toBe(baseState.templates);
  });
});

describe('permsReducer — TEMPLATE_ADD', () => {
  test('добавляет шаблон в конец списка', () => {
    const template = { id: 't3', name: 'Новый шаблон', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' };
    const result = permsReducer(baseState, { type: 'TEMPLATE_ADD', uid: 'u1', template });
    expect(result.templates.u1).toHaveLength(3);
    expect(result.templates.u1[2]).toBe(template);
  });

  test('создаёт массив для нового uid', () => {
    const template = { id: 't10', name: 'Шаблон u3', type: 'tech', category: 'service', visitorName: '', visitorPhone: '', carPlate: '', comment: '' };
    const result = permsReducer(baseState, { type: 'TEMPLATE_ADD', uid: 'u3', template });
    expect(result.templates.u3).toHaveLength(1);
    expect(result.templates.u3[0]).toBe(template);
  });

  test('не мутирует существующий массив шаблонов', () => {
    const template = { id: 't3', name: 'Новый', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' };
    const original = [...baseState.templates.u1];
    permsReducer(baseState, { type: 'TEMPLATE_ADD', uid: 'u1', template });
    expect(baseState.templates.u1).toEqual(original);
  });

  test('шаблоны u2 (пустой) не трогаются при добавлении в u1', () => {
    const template = { id: 't3', name: 'Новый', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' };
    const result = permsReducer(baseState, { type: 'TEMPLATE_ADD', uid: 'u1', template });
    expect(result.templates.u2).toBe(baseState.templates.u2);
  });
});

describe('permsReducer — TEMPLATE_DELETE', () => {
  test('удаляет шаблон по id', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATE_DELETE', uid: 'u1', id: 't1' });
    expect(result.templates.u1).toHaveLength(1);
    expect(result.templates.u1[0].id).toBe('t2');
  });

  test('если id не найден — список не изменяется', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATE_DELETE', uid: 'u1', id: 'nonexistent' });
    expect(result.templates.u1).toHaveLength(2);
  });

  test('удаление из пустого списка не вызывает ошибку', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATE_DELETE', uid: 'u2', id: 't1' });
    expect(result.templates.u2).toEqual([]);
  });

  test('удаление из несуществующего uid не вызывает ошибку', () => {
    expect(() =>
      permsReducer(baseState, { type: 'TEMPLATE_DELETE', uid: 'u99', id: 't1' })
    ).not.toThrow();
  });

  test('удаление последнего шаблона даёт пустой массив', () => {
    const singleState = { ...baseState, templates: { u1: [{ id: 't1', name: 'X', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' }] } };
    const result = permsReducer(singleState, { type: 'TEMPLATE_DELETE', uid: 'u1', id: 't1' });
    expect(result.templates.u1).toEqual([]);
  });

  test('perms не изменяются', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATE_DELETE', uid: 'u1', id: 't1' });
    expect(result.perms).toBe(baseState.perms);
  });
});

describe('permsReducer — TEMPLATES_SET', () => {
  test('заменяет весь список шаблонов для uid', () => {
    const templates = [{ id: 'tnew', name: 'Новый', type: 'tech', category: 'service', visitorName: '', visitorPhone: '', carPlate: '', comment: '' }];
    const result = permsReducer(baseState, { type: 'TEMPLATES_SET', uid: 'u1', templates });
    expect(result.templates.u1).toBe(templates);
  });

  test('устанавливает пустой список (очистка)', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATES_SET', uid: 'u1', templates: [] });
    expect(result.templates.u1).toEqual([]);
  });

  test('шаблоны других пользователей не трогаются', () => {
    const result = permsReducer(baseState, { type: 'TEMPLATES_SET', uid: 'u1', templates: [] });
    expect(result.templates.u2).toBe(baseState.templates.u2);
  });

  test('устанавливает шаблоны для нового uid', () => {
    const templates = [{ id: 't5', name: 'U3 шаблон', type: 'pass', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' }];
    const result = permsReducer(baseState, { type: 'TEMPLATES_SET', uid: 'u3', templates });
    expect(result.templates.u3).toBe(templates);
    expect(result.templates.u1).toBe(baseState.templates.u1);
  });
});

describe('permsReducer — default', () => {
  test('неизвестный экшен возвращает то же самое состояние', () => {
    const result = permsReducer(baseState, { type: 'UNKNOWN' } as any);
    expect(result).toBe(baseState);
  });
});
