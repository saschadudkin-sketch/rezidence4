'use strict';

const {
  parsePaginationParams,
  buildPageMeta,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
} = require('../v1/lib/pagination');

describe('parsePaginationParams', () => {
  test('returns defaults when query is empty', () => {
    expect(parsePaginationParams({})).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('returns defaults when query is undefined', () => {
    expect(parsePaginationParams(undefined)).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('parses valid limit and offset', () => {
    expect(parsePaginationParams({ limit: '10', offset: '20' }))
      .toEqual({ limit: 10, offset: 20 });
  });

  test('accepts numeric (not just string) limit', () => {
    expect(parsePaginationParams({ limit: 25 })).toEqual({ limit: 25, offset: 0 });
  });

  test('treats empty string as default', () => {
    expect(parsePaginationParams({ limit: '', offset: '' }))
      .toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('throws on non-integer limit', () => {
    expect(() => parsePaginationParams({ limit: 'abc' })).toThrow(/Invalid limit/);
    expect(() => parsePaginationParams({ limit: '1.5' })).toThrow(/Invalid limit/);
  });

  test('throws on limit below 1', () => {
    expect(() => parsePaginationParams({ limit: '0' })).toThrow(/must be 1\.\./);
    expect(() => parsePaginationParams({ limit: '-1' })).toThrow(/must be 1\.\./);
  });

  test(`throws on limit above MAX_LIMIT (${MAX_LIMIT})`, () => {
    expect(() => parsePaginationParams({ limit: String(MAX_LIMIT + 1) }))
      .toThrow(/must be 1\.\./);
  });

  test('throws on negative offset', () => {
    expect(() => parsePaginationParams({ offset: '-5' })).toThrow(/must be 0\.\./);
  });

  test(`throws on offset above MAX_OFFSET (${MAX_OFFSET})`, () => {
    expect(() => parsePaginationParams({ offset: String(MAX_OFFSET + 1) }))
      .toThrow(/must be 0\.\./);
  });

  test('throws on non-integer offset', () => {
    expect(() => parsePaginationParams({ offset: 'next' })).toThrow(/Invalid offset/);
  });
});

describe('buildPageMeta', () => {
  test('hasMore=true when returnedCount equals limit', () => {
    expect(buildPageMeta({ limit: 50, offset: 0, returnedCount: 50 }))
      .toEqual({ limit: 50, offset: 0, hasMore: true });
  });

  test('hasMore=false when returnedCount is less than limit', () => {
    expect(buildPageMeta({ limit: 50, offset: 100, returnedCount: 12 }))
      .toEqual({ limit: 50, offset: 100, hasMore: false });
  });

  test('hasMore=false when returnedCount is 0', () => {
    expect(buildPageMeta({ limit: 50, offset: 1000, returnedCount: 0 }))
      .toEqual({ limit: 50, offset: 1000, hasMore: false });
  });
});
