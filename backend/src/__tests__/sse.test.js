'use strict';
/**
 * __tests__/sse.test.js
 * Покрывает: addClient, removeClient, broadcastRequestUpdate (SEC-2 фильтрация по роли),
 *            broadcastChatMessage, broadcastChatUpdate, broadcastChatDelete,
 *            лимит MAX_CONNECTIONS_PER_USER
 */

// Перезагружаем модуль перед каждым тестом — сбрасываем in-memory Map
beforeEach(() => { jest.resetModules(); });

function getSse() {
  return require('../sse');
}

function mockRes() {
  return {
    write: jest.fn(),
    end:   jest.fn(),
  };
}

// Ждём setImmediate (sse использует setImmediate для write)
const flushImmediate = () => new Promise(r => setImmediate(r));

describe('addClient / removeClient', () => {
  test('addClient не бросает ошибку', () => {
    const sse = getSse();
    const res = mockRes();
    expect(() => sse.addClient('u1', res, 'owner')).not.toThrow();
  });

  test('removeClient после addClient не бросает ошибку', () => {
    const sse = getSse();
    const res = mockRes();
    sse.addClient('u1', res, 'owner');
    expect(() => sse.removeClient('u1', res)).not.toThrow();
  });

  test('removeClient несуществующего uid не бросает ошибку', () => {
    const sse = getSse();
    const res = mockRes();
    expect(() => sse.removeClient('nonexistent', res)).not.toThrow();
  });

  test('удаление корректно чистит Map (после удаления broadcast не пишет)', async () => {
    const sse = getSse();
    const res = mockRes();
    sse.addClient('u1', res, 'owner');
    sse.removeClient('u1', res);

    sse.broadcastChatMessage({ id: 'm1', text: 'привет' });
    await flushImmediate();

    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('MAX_CONNECTIONS_PER_USER (лимит 5)', () => {
  test('6-е соединение вытесняет первое', async () => {
    const sse = getSse();
    const responses = Array.from({ length: 6 }, () => mockRes());

    for (let i = 0; i < 6; i++) {
      sse.addClient('u1', responses[i], 'owner');
    }

    // Первый res должен был быть завершён (end вызван)
    expect(responses[0].end).toHaveBeenCalledTimes(1);
    // Остальные (1-5) не завершены
    for (let i = 1; i < 6; i++) {
      expect(responses[i].end).not.toHaveBeenCalled();
    }
  });

  test('5 соединений принимаются без вытеснения', () => {
    const sse = getSse();
    const responses = Array.from({ length: 5 }, () => mockRes());

    for (let i = 0; i < 5; i++) {
      sse.addClient('u1', responses[i], 'owner');
    }

    for (const res of responses) {
      expect(res.end).not.toHaveBeenCalled();
    }
  });
});

describe('SEC-2: broadcastRequestUpdate — фильтрация по роли', () => {
  const req = { id: 'r1', createdByUid: 'u1', status: 'approved', type: 'pass' };

  test('персонал (security) получает любую заявку', async () => {
    const sse = getSse();
    const guardRes = mockRes();
    sse.addClient('g1', guardRes, 'security');

    sse.broadcastRequestUpdate(req);
    await flushImmediate();

    expect(guardRes.write).toHaveBeenCalledTimes(1);
    const payload = guardRes.write.mock.calls[0][0];
    expect(payload).toContain('request_update');
    expect(payload).toContain('"r1"');
  });

  test('персонал (concierge) получает любую заявку', async () => {
    const sse = getSse();
    const conRes = mockRes();
    sse.addClient('c1', conRes, 'concierge');

    sse.broadcastRequestUpdate(req);
    await flushImmediate();

    expect(conRes.write).toHaveBeenCalledTimes(1);
  });

  test('admin получает любую заявку', async () => {
    const sse = getSse();
    const adminRes = mockRes();
    sse.addClient('a1', adminRes, 'admin');

    sse.broadcastRequestUpdate(req);
    await flushImmediate();

    expect(adminRes.write).toHaveBeenCalledTimes(1);
  });

  test('создатель заявки (owner) получает свою заявку', async () => {
    const sse = getSse();
    const ownerRes = mockRes();
    sse.addClient('u1', ownerRes, 'owner'); // u1 === req.createdByUid

    sse.broadcastRequestUpdate(req);
    await flushImmediate();

    expect(ownerRes.write).toHaveBeenCalledTimes(1);
  });

  test('другой owner НЕ получает чужую заявку', async () => {
    const sse = getSse();
    const otherRes = mockRes();
    sse.addClient('u2', otherRes, 'owner'); // u2 !== u1

    sse.broadcastRequestUpdate(req); // req.createdByUid = 'u1'
    await flushImmediate();

    expect(otherRes.write).not.toHaveBeenCalled();
  });

  test('tenant НЕ получает чужую заявку', async () => {
    const sse = getSse();
    const tenantRes = mockRes();
    sse.addClient('t1', tenantRes, 'tenant');

    sse.broadcastRequestUpdate(req);
    await flushImmediate();

    expect(tenantRes.write).not.toHaveBeenCalled();
  });
});

describe('broadcastChatMessage/Update/Delete — рассылка всем', () => {
  test('broadcastChatMessage получают все подключённые клиенты', async () => {
    const sse = getSse();
    const ownerRes   = mockRes();
    const securityRes = mockRes();
    sse.addClient('u1', ownerRes,    'owner');
    sse.addClient('g1', securityRes, 'security');

    sse.broadcastChatMessage({ id: 'm1', text: 'Привет' });
    await flushImmediate();

    expect(ownerRes.write).toHaveBeenCalledTimes(1);
    expect(securityRes.write).toHaveBeenCalledTimes(1);

    const payload = ownerRes.write.mock.calls[0][0];
    expect(payload).toContain('event: message');
    expect(payload).toContain('"Привет"');
  });

  test('broadcastChatUpdate рассылает событие message_update', async () => {
    const sse = getSse();
    const res = mockRes();
    sse.addClient('u1', res, 'owner');

    sse.broadcastChatUpdate({ id: 'm1', text: 'Изменено' });
    await flushImmediate();

    expect(res.write.mock.calls[0][0]).toContain('event: message_update');
  });

  test('broadcastChatDelete рассылает событие message_delete с id', async () => {
    const sse = getSse();
    const res = mockRes();
    sse.addClient('u1', res, 'owner');

    sse.broadcastChatDelete('m1');
    await flushImmediate();

    const payload = res.write.mock.calls[0][0];
    expect(payload).toContain('event: message_delete');
    expect(payload).toContain('"m1"');
  });

  test('без подключённых клиентов broadcast не бросает ошибку', () => {
    const sse = getSse();
    expect(() => sse.broadcastChatMessage({ id: 'm1' })).not.toThrow();
    expect(() => sse.broadcastRequestUpdate({ id: 'r1', createdByUid: 'u1' })).not.toThrow();
  });
});

describe('broadcastToAll — устойчивость при закрытых соединениях', () => {
  test('write бросает ошибку — не прерывает рассылку другим клиентам', async () => {
    const sse = getSse();
    const badRes  = { write: jest.fn().mockImplementation(() => { throw new Error('broken pipe'); }), end: jest.fn() };
    const goodRes = mockRes();

    sse.addClient('u1', badRes,  'owner');
    sse.addClient('u2', goodRes, 'owner');

    expect(() => {
      sse.broadcastChatMessage({ id: 'm1', text: 'test' });
    }).not.toThrow();

    await flushImmediate();
    // goodRes должен получить сообщение несмотря на ошибку badRes
    expect(goodRes.write).toHaveBeenCalledTimes(1);
  });
});
