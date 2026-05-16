import { describe, expect, test } from 'vitest';
import { API_BASE_URL, apiV1Url } from './apiBaseUrl';

describe('apiV1Url', () => {
  test('builds v1 API URLs from normalized and relative paths', () => {
    expect(apiV1Url('/public/pass/token')).toBe(`${API_BASE_URL}/api/v1/public/pass/token`);
    expect(apiV1Url('units/import/template')).toBe(`${API_BASE_URL}/api/v1/units/import/template`);
  });
});
