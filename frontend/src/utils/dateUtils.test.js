/**
 * utils/dateUtils.test.js
 * Покрывает: fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs
 */

import { fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs } from './dateUtils';

// ─── fmtDate ──────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('возвращает "" для null/undefined', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });

  it('«только что» для даты менее 1 минуты назад', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const d = new Date('2026-03-15T11:59:30'); // 30 секунд назад
    expect(fmtDate(d)).toBe('только что');
  });

  it('«N мин. назад» для 1–59 минут назад', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const d = new Date('2026-03-15T11:45:00'); // 15 минут назад
    expect(fmtDate(d)).toBe('15 мин. назад');
  });

  it('«5 мин. назад» для точно 5 минут', () => {
    jest.setSystemTime(new Date('2026-03-15T12:05:00'));
    const d = new Date('2026-03-15T12:00:00');
    expect(fmtDate(d)).toBe('5 мин. назад');
  });

  it('«сегодня» для даты в этом же дне, более 1 часа назад', () => {
    jest.setSystemTime(new Date('2026-03-15T15:00:00'));
    const d = new Date('2026-03-15T09:00:00'); // 6 часов назад — сегодня
    expect(fmtDate(d)).toBe('сегодня');
  });

  it('«вчера» для вчерашней даты', () => {
    jest.setSystemTime(new Date('2026-03-15T10:00:00'));
    const d = new Date('2026-03-14T20:00:00'); // вчера вечером
    expect(fmtDate(d)).toBe('вчера');
  });

  it('дд.мм для более старых дат', () => {
    jest.setSystemTime(new Date('2026-03-15T10:00:00'));
    const d = new Date('2026-03-10T10:00:00'); // 5 дней назад
    // toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    expect(fmtDate(d)).toMatch(/^\d{2}\.\d{2}$/);
    expect(fmtDate(d)).toBe('10.03');
  });

  it('принимает строку ISO наравне с объектом Date', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const iso = new Date('2026-03-15T11:59:30').toISOString();
    expect(fmtDate(iso)).toBe('только что');
  });
});

// ─── fmtTime ──────────────────────────────────────────────────────────────────

describe('fmtTime', () => {
  it('возвращает "" для null', () => {
    expect(fmtTime(null)).toBe('');
    expect(fmtTime(undefined)).toBe('');
  });

  it('форматирует время в ЧЧ:ММ', () => {
    const d = new Date(2026, 2, 15, 9, 5, 0); // 09:05 локальное время
    const result = fmtTime(d);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
    expect(result).toBe('09:05');
  });

  it('форматирует строку ISO', () => {
    const d = new Date(2026, 2, 15, 14, 30, 0);
    expect(fmtTime(d.toISOString())).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ─── filterByPeriod ───────────────────────────────────────────────────────────

describe('filterByPeriod', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const reqs = () => {
    const now = Date.now();
    return [
      { id: '1', createdAt: new Date(now - 1 * 3600 * 1000).toISOString() },   // 1ч назад — сегодня
      { id: '2', createdAt: new Date(now - 25 * 3600 * 1000).toISOString() },  // 25ч назад — вчера
      { id: '3', createdAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString() }, // 8 дней назад
    ];
  };

  it('«all» возвращает все без фильтрации', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const arr = reqs();
    expect(filterByPeriod(arr, 'all')).toHaveLength(3);
  });

  it('«today» возвращает только за последние 24ч', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const arr = reqs();
    const result = filterByPeriod(arr, 'today');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('«week» возвращает за последние 7 дней', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const arr = reqs();
    const result = filterByPeriod(arr, 'week');
    expect(result).toHaveLength(2); // 1ч и 25ч — оба в пределах 7 дней
    expect(result.map(r => r.id).sort()).toEqual(['1', '2']);
  });

  it('пустой массив остаётся пустым', () => {
    expect(filterByPeriod([], 'today')).toEqual([]);
  });
});

// ─── groupReqs ────────────────────────────────────────────────────────────────

describe('groupReqs', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('группирует по «Сегодня», «Вчера», «Ранее»', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const now = Date.now();
    const arr = [
      { id: 't', createdAt: new Date(now - 1 * 3600 * 1000).toISOString() },    // сегодня
      { id: 'y', createdAt: new Date(now - 25 * 3600 * 1000).toISOString() },   // вчера
      { id: 'e', createdAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString() }, // ранее
    ];
    const groups = groupReqs(arr);
    expect(groups).toHaveLength(3);
    const labels = groups.map(g => g.label);
    expect(labels).toContain('Сегодня');
    expect(labels).toContain('Вчера');
    expect(labels).toContain('Ранее');
  });

  it('не создаёт пустые группы', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const now = Date.now();
    // Только сегодняшние
    const arr = [
      { id: '1', createdAt: new Date(now - 1000).toISOString() },
      { id: '2', createdAt: new Date(now - 5000).toISOString() },
    ];
    const groups = groupReqs(arr);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Сегодня');
    expect(groups[0].items).toHaveLength(2);
  });

  it('пустой массив → пустой результат', () => {
    expect(groupReqs([])).toEqual([]);
  });

  it('все элементы попадают в нужные группы без потерь', () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00'));
    const now = Date.now();
    const arr = [
      { id: 'a', createdAt: new Date(now - 2 * 3600 * 1000).toISOString() },
      { id: 'b', createdAt: new Date(now - 30 * 3600 * 1000).toISOString() },
      { id: 'c', createdAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString() },
    ];
    const groups = groupReqs(arr);
    const allIds = groups.flatMap(g => g.items.map(i => i.id)).sort();
    expect(allIds).toEqual(['a', 'b', 'c']);
  });
});

// ─── sortReqs ─────────────────────────────────────────────────────────────────

describe('sortReqs', () => {
  const mkReq = (id, status, createdAt) => ({ id, status, createdAt });

  it('pending идёт перед approved при одинаковом времени', () => {
    const arr = [
      mkReq('2', 'approved', '2026-03-15T10:00:00'),
      mkReq('1', 'pending',  '2026-03-15T10:00:00'),
    ];
    const sorted = sortReqs(arr);
    expect(sorted[0].id).toBe('1'); // pending первый
  });

  it('scheduled идёт после pending, но до других статусов', () => {
    const arr = [
      mkReq('3', 'approved',   '2026-03-15T10:00:00'),
      mkReq('2', 'scheduled',  '2026-03-15T10:00:00'),
      mkReq('1', 'pending',    '2026-03-15T10:00:00'),
    ];
    const sorted = sortReqs(arr);
    expect(sorted[0].status).toBe('pending');
    expect(sorted[1].status).toBe('scheduled');
    expect(sorted[2].status).toBe('approved');
  });

  it('среди одинакового статуса — более новые первыми', () => {
    const arr = [
      mkReq('old', 'approved', '2026-03-10T10:00:00'),
      mkReq('new', 'approved', '2026-03-15T10:00:00'),
    ];
    const sorted = sortReqs(arr);
    expect(sorted[0].id).toBe('new');
  });

  it('pending с более старой датой стоит перед approved с новой датой', () => {
    const arr = [
      mkReq('fresh-approved', 'approved', '2026-03-15T12:00:00'),
      mkReq('old-pending',    'pending',  '2026-03-01T10:00:00'),
    ];
    const sorted = sortReqs(arr);
    expect(sorted[0].id).toBe('old-pending');
  });

  it('не мутирует исходный массив', () => {
    const arr = [
      mkReq('2', 'approved', '2026-03-15T10:00:00'),
      mkReq('1', 'pending',  '2026-03-15T10:00:00'),
    ];
    const copy = [...arr];
    sortReqs(arr);
    expect(arr[0].id).toBe(copy[0].id);
  });

  it('пустой массив → пустой результат', () => {
    expect(sortReqs([])).toEqual([]);
  });

  it('один элемент → возвращается как есть', () => {
    const arr = [mkReq('1', 'pending', '2026-03-15T10:00:00')];
    expect(sortReqs(arr)).toHaveLength(1);
  });
});
