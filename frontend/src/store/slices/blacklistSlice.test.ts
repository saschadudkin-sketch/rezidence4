/**
 * blacklistSlice.test.js — тесты чёрного списка
 */

import { checkBlacklist } from './blacklistSlice';

describe('checkBlacklist', () => {
  const bl: any = [
    { id: 'bl1', name: 'Петров Сергей', carPlate: '', reason: '', addedBy: '', addedAt: '' },
    { id: 'bl2', name: '', carPlate: 'Х666ХХ77', reason: '', addedBy: '', addedAt: '' },
  ];

  test('exact name match', () => {
    const req = { visitorName: 'Петров Сергей', carPlate: '' };
    expect(checkBlacklist(req, bl)).toEqual(bl[0]);
  });

  test('no substring match (Иван !== Иванченко)', () => {
    const entry: any = [{ id: 'bl3', name: 'Иван', carPlate: '', reason: '', addedBy: '', addedAt: '' }];
    const req = { visitorName: 'Иванченко Петр', carPlate: '' };
    expect(checkBlacklist(req, entry)).toBeNull();
  });

  test('exact plate match', () => {
    const req = { visitorName: '', carPlate: 'Х666ХХ77' };
    expect(checkBlacklist(req, bl)).toEqual(bl[1]);
  });

  test('plate with spaces/dashes normalized', () => {
    const req = { visitorName: '', carPlate: 'Х 666 ХХ-77' };
    expect(checkBlacklist(req, bl)).toEqual(bl[1]);
  });

  test('no match returns null', () => {
    const req = { visitorName: 'Никто', carPlate: 'А000АА00' };
    expect(checkBlacklist(req, bl)).toBeNull();
  });

  test('empty blacklist returns null', () => {
    expect(checkBlacklist({ visitorName: 'Тест' }, [])).toBeNull();
  });

  test('word-by-word match for multi-word names', () => {
    const entry: any = [{ id: 'bl4', name: 'Петров Сергей', carPlate: '', reason: '', addedBy: '', addedAt: '' }];
    const req = { visitorName: 'Сергей Петров', carPlate: '' };
    expect(checkBlacklist(req, entry)).toEqual(entry[0]);
  });
});
