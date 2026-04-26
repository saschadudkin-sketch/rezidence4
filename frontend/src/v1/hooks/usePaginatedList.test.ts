/**
 * Unit tests for `extractItems` — the pure helper в usePaginatedList.
 *
 * Сам хук тестируется через интеграцию (он thin враппер над useInfiniteQuery
 * с published contract'ом).  extractItems — pure function на data shapes,
 * стоит покрыть отдельно.
 */

import { describe, expect, test } from 'vitest';
import { extractItems } from './usePaginatedList';

describe('extractItems', () => {
  test('returns empty array for empty pages', () => {
    expect(extractItems([], 'passes')).toEqual([]);
  });

  test('flattens single page resource array', () => {
    const pages = [{ passes: [{ id: 'a' }, { id: 'b' }] }];
    expect(extractItems<{ id: string }, 'passes'>(pages, 'passes'))
      .toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  test('concatenates multiple pages preserving order', () => {
    const pages = [
      { passes: [{ id: 'p1' }, { id: 'p2' }] },
      { passes: [{ id: 'p3' }] },
      { passes: [{ id: 'p4' }, { id: 'p5' }] },
    ];
    const result = extractItems<{ id: string }, 'passes'>(pages, 'passes');
    expect(result.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  test('skips pages where the key is missing or non-array', () => {
    const pages = [
      { passes: [{ id: 'a' }] },
      { passes: undefined } as unknown as { passes: unknown[] },
      { other: [{ id: 'b' }] },
      { passes: [{ id: 'c' }] },
    ];
    const result = extractItems<{ id: string }, 'passes'>(pages, 'passes');
    expect(result.map((r) => r.id)).toEqual(['a', 'c']);
  });

  test('handles empty resource arrays', () => {
    const pages = [{ vehicles: [] }, { vehicles: [{ plate_number: 'A001' }] }];
    expect(extractItems<{ plate_number: string }, 'vehicles'>(pages, 'vehicles'))
      .toEqual([{ plate_number: 'A001' }]);
  });
});
