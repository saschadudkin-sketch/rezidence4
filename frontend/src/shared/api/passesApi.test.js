/**
 * passesApi.test.js
 * Тестируем через createPassesApiState() — каждый тест получает чистый экземпляр.
 */
import { createPassesApiState } from './passesApi';

describe('passesApi — createPass и getPasses', () => {
  let api;
  beforeEach(() => { api = createPassesApiState(); });

  test('createPass сохраняет и возвращает запись', async () => {
    await api.createPass({ userId: 'u1', validUntil: '2030-01-01T00:00:00.000Z' });
    const passes = await api.getPasses();
    expect(passes).toHaveLength(1);
    expect(passes[0].userId).toBe('u1');
  });

  test('createPass генерирует id если не передан', async () => {
    await api.createPass({ userId: 'u2' });
    const passes = await api.getPasses();
    expect(passes[0].id).toBeTruthy();
  });
});

describe('passesApi — validatePass', () => {
  let api;
  beforeEach(() => { api = createPassesApiState(); });

  test('возвращает denied для истёкшего пропуска', async () => {
    const result = await api.validatePass(
      { userId: 'u1', validUntil: '2020-01-01T00:00:00.000Z' },
      { now: new Date('2021-01-01T00:00:00.000Z') },
    );
    expect(result.status).toBe('denied');
  });
});

describe('passesApi — logVisit и getVisitLogs', () => {
  let api;
  beforeEach(() => { api = createPassesApiState(); });

  test('logVisit сохраняет запись', async () => {
    const entry = await api.logVisit({ userId: 'u1', requestId: 'r1', result: 'allowed', reason: 'ok' });
    expect(entry.userId).toBe('u1');
    expect(entry.result).toBe('allowed');
  });

  test('getVisitLogs возвращает созданные записи', async () => {
    await api.logVisit({ userId: 'u1', requestId: 'r1', result: 'allowed', reason: 'ok' });
    const logs = await api.getVisitLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const found = logs.find(l => l.requestId === 'r1');
    expect(found).toBeTruthy();
    expect(found.reason).toBe('ok');
  });

  test('getVisitLogs — новые записи идут первыми (reverse-chronological)', async () => {
    await api.logVisit({ userId: 'u1', requestId: 'older', result: 'allowed', reason: 'ok' });
    await new Promise(r => setTimeout(r, 2));
    await api.logVisit({ userId: 'u1', requestId: 'newer', result: 'denied',  reason: 'expired' });
    const logs = await api.getVisitLogs();
    const newerIdx = logs.findIndex(l => l.requestId === 'newer');
    const olderIdx = logs.findIndex(l => l.requestId === 'older');
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  test('clearVisitLogs удаляет все записи', async () => {
    await api.logVisit({ userId: 'u1', requestId: 'r2', result: 'allowed', reason: 'ok' });
    await api.__reset();
    const logs = await api.getVisitLogs();
    expect(logs).toHaveLength(0);
  });
});
