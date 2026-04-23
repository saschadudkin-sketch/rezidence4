'use strict';

/**
 * Phase 3 (D-lite) — normalizePlate unit tests.
 * Spec: docs/product/specs/platform-v1/vehicles-spec.md §6.1
 *
 * Эти тесты защищают единственное место, где мы делаем кириллица↔латиница
 * транслитерацию по госномеру.  Любая ошибка здесь отражается на всём
 * access-potoке: verify не найдёт vehicle, blacklist не сработает.
 */

const { describe, test, expect } = require('@jest/globals');
const { normalizePlate, looksLikeRuPlate } = require('../v1/lib/normalizePlate');

describe('normalizePlate — Cyrillic → Latin transliteration (12 pairs)', () => {
  const pairs = [
    ['А', 'A'], ['В', 'B'], ['Е', 'E'], ['К', 'K'],
    ['М', 'M'], ['Н', 'H'], ['О', 'O'], ['Р', 'P'],
    ['С', 'C'], ['Т', 'T'], ['У', 'Y'], ['Х', 'X'],
  ];
  for (const [cyr, lat] of pairs) {
    test(`upper-case ${cyr} → ${lat}`, () => {
      expect(normalizePlate(cyr)).toBe(lat);
    });
    test(`lower-case ${cyr.toLowerCase()} → ${lat}`, () => {
      expect(normalizePlate(cyr.toLowerCase())).toBe(lat);
    });
  }
});

describe('normalizePlate — whole-plate canonicalisation', () => {
  test('Cyrillic plate with spaces → Latin no-space', () => {
    expect(normalizePlate('А 001 АА 77')).toBe('A001AA77');
  });

  test('Cyrillic lower-case → Latin upper-case', () => {
    expect(normalizePlate('а001аа77')).toBe('A001AA77');
  });

  test('Latin lower with dashes → Latin upper no-dash', () => {
    expect(normalizePlate('a-001-aa-77')).toBe('A001AA77');
  });

  test('Mixed dots, tabs, weird whitespace — all stripped', () => {
    expect(normalizePlate('А.001\tАА\n77')).toBe('A001AA77');
  });

  test('3-digit region code preserved', () => {
    expect(normalizePlate('А001АА177')).toBe('A001AA177');
  });

  test('already normalised plate — identity', () => {
    expect(normalizePlate('A001AA77')).toBe('A001AA77');
  });
});

describe('normalizePlate — edge cases', () => {
  test('empty string → empty string', () => {
    expect(normalizePlate('')).toBe('');
  });
  test('null → empty string', () => {
    expect(normalizePlate(null)).toBe('');
  });
  test('undefined → empty string', () => {
    expect(normalizePlate(undefined)).toBe('');
  });
  test('number → empty string (not a string type)', () => {
    expect(normalizePlate(12345)).toBe('');
  });
  test('Cyrillic letter not in map (Ж) → stripped', () => {
    // «А001ЖА77»: Ж не в 12-парах; удаляется, получаем аномалию — сервис должен 422.
    // Тест фиксирует: normalizePlate не бросает, просто отдаёт «повреждённый» номер.
    expect(normalizePlate('А001ЖА77')).toBe('A001A77');
  });
  test('symbols (emoji, punctuation) stripped', () => {
    expect(normalizePlate('А👍001!АА@77')).toBe('A001AA77');
  });
});

describe('looksLikeRuPlate — standard civil-plate regex', () => {
  test('valid 2-digit region', () => {
    expect(looksLikeRuPlate('A001AA77')).toBe(true);
  });
  test('valid 3-digit region', () => {
    expect(looksLikeRuPlate('A001AA177')).toBe(true);
  });
  test('too short region', () => {
    expect(looksLikeRuPlate('A001AA7')).toBe(false);
  });
  test('wrong digit count in middle', () => {
    expect(looksLikeRuPlate('A01AA77')).toBe(false);
  });
  test('invalid letter in letters (F not in RU set)', () => {
    expect(looksLikeRuPlate('A001AF77')).toBe(false);
  });
  test('lower-case never matches (normalizePlate upper-cases first)', () => {
    expect(looksLikeRuPlate('a001aa77')).toBe(false);
  });
  test('empty string is not a plate', () => {
    expect(looksLikeRuPlate('')).toBe(false);
  });
});

describe('normalizePlate + looksLikeRuPlate integration', () => {
  test('Cyrillic input → normalized → valid standard plate', () => {
    const n = normalizePlate('а 001 аа 77');
    expect(n).toBe('A001AA77');
    expect(looksLikeRuPlate(n)).toBe(true);
  });
  test('commercial plate passes normalize but fails strict regex', () => {
    const n = normalizePlate('FE12345');  // fake dealer plate
    expect(n).toBe('FE12345');
    expect(looksLikeRuPlate(n)).toBe(false);
  });
});
