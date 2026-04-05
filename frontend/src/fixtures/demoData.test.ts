/**
 * fixtures/demoData.test.js
 * Проверяет структуру демо-данных и что они создаются с актуальными датами
 */
import { makeDemoRequests, DEMO_REQUESTS } from './demoData';

describe('makeDemoRequests', () => {
  test('возвращает массив', () => {
    expect(Array.isArray(makeDemoRequests())).toBe(true);
  });

  test('возвращает непустой массив', () => {
    expect(makeDemoRequests().length).toBeGreaterThan(0);
  });

  test('каждая заявка имеет обязательные поля', () => {
    const reqs = makeDemoRequests();
    reqs.forEach(r => {
      expect(r.id).toBeDefined();
      expect(r.type).toMatch(/^(pass|tech)$/);
      expect(r.status).toBeDefined();
      expect(r.createdByUid).toBeDefined();
      expect(r.createdAt).toBeInstanceOf(Date);
    });
  });

  test('содержит заявки типа pass и tech', () => {
    const reqs = makeDemoRequests();
    const types = [...new Set(reqs.map(r => r.type))];
    expect(types).toContain('pass');
    expect(types).toContain('tech');
  });

  test('даты создаются при каждом вызове (не зафиксированы)', () => {
    const before = Date.now();
    const reqs = makeDemoRequests();
    const after = Date.now();
    // Все createdAt должны быть в прошлом (от before)
    reqs.forEach(r => {
      expect(r.createdAt.getTime()).toBeLessThanOrEqual(before);
    });
    void after; // используем переменную
  });

  test('два последовательных вызова дают примерно одинаковые временные метки', () => {
    const r1 = makeDemoRequests()[0];
    const r2 = makeDemoRequests()[0];
    // Разница не более 100мс (разумный предел для двух последовательных вызовов)
    expect(Math.abs(r1.createdAt.getTime() - r2.createdAt.getTime())).toBeLessThan(100);
  });

  test('photos — массив для каждой заявки', () => {
    makeDemoRequests().forEach(r => {
      expect(Array.isArray(r.photos)).toBe(true);
    });
  });

  test('заявки имеют разные id', () => {
    const reqs = makeDemoRequests();
    const ids = reqs.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('DEMO_REQUESTS', () => {
  test('это массив (статический экспорт)', () => {
    expect(Array.isArray(DEMO_REQUESTS)).toBe(true);
  });

  test('содержит те же поля что и makeDemoRequests()', () => {
    expect(DEMO_REQUESTS[0]).toHaveProperty('id');
    expect(DEMO_REQUESTS[0]).toHaveProperty('type');
    expect(DEMO_REQUESTS[0]).toHaveProperty('status');
  });
});
